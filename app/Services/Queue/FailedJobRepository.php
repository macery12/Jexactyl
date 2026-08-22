<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Str;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Artisan;

/**
 * Reads and recovers the `failed_jobs` table for /admin/queues.
 *
 * The table is used rather than Horizon's own failed-job repository on purpose.
 * It is the durable record -- it survives a Redis flush, which Horizon's does
 * not -- the health snapshot already counts from it, and its retention happens
 * to match: `queue:prune-failed --hours=168` and Horizon's `trim.failed` of
 * 10080 minutes are both seven days.
 */
class FailedJobRepository
{
    /** Enough of the trace to diagnose from, without shipping a megabyte to a browser. */
    private const MAX_EXCEPTION_CHARS = 20000;

    public function __construct(private QueueTopology $topology)
    {
    }

    /**
     * Whether failures are stored somewhere this can read at all. A `null`
     * driver, or one of the non-database drivers, is a legitimate setup -- it
     * just means there is nothing to list.
     */
    public function available(): bool
    {
        if (!str_starts_with((string) config('queue.failed.driver'), 'database')) {
            return false;
        }

        try {
            return Schema::connection(config('queue.failed.database'))->hasTable($this->table());
        } catch (\Throwable $e) {
            Log::debug('FailedJobRepository: could not reach the failed-job table', ['error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * Newest first, because a failure you have not seen yet is almost always
     * the one you are looking for.
     *
     * @return array{items: list<array<string, mixed>>, total: int, page: int, perPage: int, queues: list<string>}
     */
    public function paginate(int $perPage = 25, int $page = 1, ?string $queue = null): array
    {
        $empty = ['items' => [], 'total' => 0, 'page' => 1, 'perPage' => $perPage, 'queues' => []];

        if (!$this->available()) {
            return $empty;
        }

        try {
            $base = $this->query();

            // The lanes actually represented, so the filter offers what exists
            // rather than every lane the panel knows about.
            $queues = $base->clone()->distinct()->orderBy('queue')->pluck('queue')->all();

            if ($queue !== null && $queue !== '') {
                $base->where('queue', $queue);
            }

            $total = (int) $base->clone()->count();
            $page = max(1, $page);

            $rows = $base
                ->orderByDesc('failed_at')
                ->orderByDesc('id')
                ->forPage($page, $perPage)
                ->get();

            return [
                'items' => $rows->map(fn ($row) => $this->present($row))->all(),
                'total' => $total,
                'page' => $page,
                'perPage' => $perPage,
                'queues' => array_values(array_map('strval', $queues)),
            ];
        } catch (\Throwable $e) {
            Log::debug('FailedJobRepository: could not list failed jobs', ['error' => $e->getMessage()]);

            return $empty;
        }
    }

    /**
     * One failure with its full stack trace attached.
     *
     * @return array<string, mixed>|null
     */
    public function find(string $uuid): ?array
    {
        if (!$this->available()) {
            return null;
        }

        try {
            $row = $this->query()->where('uuid', $uuid)->first();
        } catch (\Throwable $e) {
            Log::debug('FailedJobRepository: could not read failed job', ['uuid' => $uuid, 'error' => $e->getMessage()]);

            return null;
        }

        if ($row === null) {
            return null;
        }

        return $this->present($row) + [
            'exception' => Str::limit((string) $row->exception, self::MAX_EXCEPTION_CHARS, "\n… trace truncated"),
        ];
    }

    /**
     * Push a failed job back onto its original queue.
     *
     * `queue:retry` is the framework's own path for this: it rewrites the
     * payload with a fresh uuid, pushes it, and deletes the failed row, so a
     * retried job cannot be retried twice from the same record. The command
     * name is a literal -- never interpolate into Artisan::call.
     */
    public function retry(string $uuid): bool
    {
        if ($this->find($uuid) === null) {
            return false;
        }

        try {
            Artisan::call('queue:retry', ['id' => [$uuid]]);
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: retry failed', ['uuid' => $uuid, 'error' => $e->getMessage()]);

            return false;
        }

        // The command reports success on its own output rather than its exit
        // code, so the row's disappearance is the reliable signal.
        return $this->wasRemoved($uuid);
    }

    private function wasRemoved(string $uuid): bool
    {
        try {
            return !$this->query()->where('uuid', $uuid)->exists();
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: could not verify retry', ['uuid' => $uuid, 'error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function present(object $row): array
    {
        $payload = json_decode((string) $row->payload, true);
        $payload = is_array($payload) ? $payload : [];

        [$class, $message] = $this->splitException((string) $row->exception);

        $queue = (string) $row->queue;

        return [
            'uuid' => (string) $row->uuid,
            // displayName is what the worker itself logs, so it matches what an
            // operator would grep for. Fall back to the serialised command class.
            'job' => $payload['displayName'] ?? ($payload['data']['commandName'] ?? 'Unknown job'),
            'connection' => (string) $row->connection,
            'queue' => $queue,
            'lane' => $this->topology->laneForQueue($queue),
            'attempts' => isset($payload['attempts']) ? (int) $payload['attempts'] : null,
            'failedAt' => $this->iso($row->failed_at),
            'exceptionClass' => $class,
            'exceptionMessage' => $message,
        ];
    }

    /**
     * The first line of a trace is `Class: message`, which is the whole story
     * in most cases and all that fits in a table row.
     *
     * @return array{0: ?string, 1: string}
     */
    private function splitException(string $exception): array
    {
        $first = trim(strtok($exception, "\n") ?: '');

        if (preg_match('/^([\w\\\\]+):\s*(.*)$/s', $first, $matches) === 1) {
            return [$matches[1], trim($matches[2])];
        }

        return [null, $first];
    }

    private function iso(mixed $value): ?string
    {
        if (empty($value)) {
            return null;
        }

        try {
            return Carbon::parse($value)->toIso8601ZuluString();
        } catch (\Throwable) {
            return (string) $value;
        }
    }

    private function query(): \Illuminate\Database\Query\Builder
    {
        return DB::connection(config('queue.failed.database'))->table($this->table());
    }

    private function table(): string
    {
        return (string) config('queue.failed.table', 'failed_jobs');
    }
}
