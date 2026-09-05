<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Str;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\Query\Builder;
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

    /**
     * The first line of a trace, bounded. A failed bulk insert produces a first
     * line kilobytes long, and the list endpoint renders twenty-five of them.
     */
    private const MAX_MESSAGE_CHARS = 2000;

    /**
     * The most rows one sweep will take.
     *
     * A sweep that walks an unbounded table is a request that does not finish:
     * it dies on the PHP time limit part-way through, having destroyed rows the
     * caller cannot afterwards enumerate. Capping it makes the work bounded and
     * the audit record honest -- the caller is told how many are left and can
     * ask again.
     */
    public const MAX_SWEEP_ROWS = 500;

    /**
     * Resolved once per instance. `available()` is asked on every single-row
     * operation, and `Schema::hasTable` is a round trip each time.
     */
    private ?bool $available = null;

    public function __construct(
        private QueueTopology $topology,
        private JobCatalogue $catalogue,
        private FailedJobRedactor $redactor,
    ) {
    }

    /**
     * Whether failures are stored somewhere this can read at all. A `null`
     * driver, or one of the non-database drivers, is a legitimate setup -- it
     * just means there is nothing to list.
     */
    public function available(): bool
    {
        if ($this->available !== null) {
            return $this->available;
        }

        if (!str_starts_with((string) config('queue.failed.driver'), 'database')) {
            return $this->available = false;
        }

        try {
            return $this->available = Schema::connection(config('queue.failed.database'))->hasTable($this->table());
        } catch (\Throwable $e) {
            Log::debug('FailedJobRepository: could not reach the failed-job table', ['error' => $e->getMessage()]);

            return $this->available = false;
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
        $row = $this->row($uuid);

        if ($row === null) {
            return null;
        }

        $payload = json_decode((string) $row->payload, true);

        return $this->present($row) + [
            // Bounded first, then masked. Laravel interpolates a query's
            // bindings into the QueryException message, so a trace is every bit
            // as revealing as the payload beside it.
            'exception' => $this->redactor->redactText(
                Str::limit((string) $row->exception, self::MAX_EXCEPTION_CHARS, "\n… trace truncated")
            ),
            // Masked, never raw: a serialised SendEmailJob carries the message
            // body and an invoice job carries billing details.
            'payload' => $this->redactor->redact(is_array($payload) ? $payload : []),
        ];
    }

    /**
     * The row's identity, without its trace or payload.
     *
     * What an audit entry needs -- which job, on which queue -- and nothing
     * else. Building the redacted payload to write a class name into a log line
     * is work nobody asked for.
     *
     * @return array<string, mixed>|null
     */
    public function summary(string $uuid): ?array
    {
        $row = $this->row($uuid);

        return $row === null ? null : $this->present($row);
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
        return $this->retryMany([$uuid]) === 1;
    }

    /**
     * Re-dispatch a selection, reporting how many actually went.
     *
     * One command call for the whole batch rather than one per row. The ids are
     * filtered to rows that exist first, for two reasons: the count returned has
     * to mean something, and `queue:retry` reads a lone id of `all` as "retry
     * every failure in the table". No uuid is ever the string `all`, but a
     * sentinel that turns one request into an unbounded one is not something to
     * leave standing on an admin endpoint.
     *
     * @param list<string> $uuids
     */
    public function retryMany(array $uuids): int
    {
        $uuids = $this->existing($uuids);

        if ($uuids === []) {
            return 0;
        }

        try {
            Artisan::call('queue:retry', ['id' => $uuids]);
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: retry failed', ['count' => count($uuids), 'error' => $e->getMessage()]);

            return 0;
        }

        // The command reports success on its own output rather than its exit
        // code, so the rows' disappearance is the reliable signal.
        return count($uuids) - count($this->existing($uuids));
    }

    /**
     * Discard one failure.
     *
     * Through the configured failer rather than `queue:forget`: identical
     * semantics -- the command is a one-line wrapper around this call -- without
     * bootstrapping a console command per row, which is what made discarding a
     * page of failures cost more than the work that produced them. The row is
     * the only copy of the payload, which is why this sits behind its own
     * capability and why the caller logs it.
     */
    public function delete(string $uuid): bool
    {
        if (!$this->available()) {
            return false;
        }

        try {
            return (bool) app('queue.failer')->forget($uuid);
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: delete failed', ['uuid' => $uuid, 'error' => $e->getMessage()]);

            return false;
        }
    }

    /**
     * Discard a selection, reporting how many actually went.
     *
     * One at a time through the same path as a single delete: a bulk DELETE
     * against the table would bypass whatever the configured failed-job driver
     * does, and a partial failure should still remove the rows it could.
     *
     * @param list<string> $uuids
     */
    public function deleteMany(array $uuids): int
    {
        $deleted = 0;

        foreach (array_unique($uuids) as $uuid) {
            if ($this->delete((string) $uuid)) {
                ++$deleted;
            }
        }

        return $deleted;
    }

    /**
     * Sweep the failures matching a scope.
     *
     * Every sweep is scoped -- by queue, by age, or both. There is deliberately
     * no shape of this call that means "delete everything": an unscoped flush
     * is one mis-click away from destroying every payload in the retention
     * window, and these two scopes cover the cases that actually come up (a
     * lane that broke, and a backlog that has aged out of usefulness).
     *
     * Null means the caller passed no scope at all, which is refused rather
     * than treated as "all". A scope matching more than MAX_SWEEP_ROWS takes
     * the first page of them and leaves the rest; the caller reports what is
     * left so the operator can decide to go again.
     */
    public function purge(?string $queue, ?int $olderThanDays): ?int
    {
        if (($queue === null || $queue === '') && $olderThanDays === null) {
            return null;
        }

        $uuids = $this->uuidsMatching($queue, $olderThanDays, self::MAX_SWEEP_ROWS);

        return $uuids === [] ? 0 : $this->deleteMany($uuids);
    }

    /**
     * How many rows a sweep would take, so a confirmation can name the exact
     * number before anything is destroyed.
     */
    public function countMatching(?string $queue, ?int $olderThanDays): int
    {
        if (!$this->available()) {
            return 0;
        }

        try {
            return (int) $this->scoped($queue, $olderThanDays)->count();
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: could not count a sweep scope', ['error' => $e->getMessage()]);

            return 0;
        }
    }

    /**
     * @return list<string>
     */
    private function uuidsMatching(?string $queue, ?int $olderThanDays, int $limit): array
    {
        if (!$this->available()) {
            return [];
        }

        try {
            return array_values(array_map('strval', $this->scoped($queue, $olderThanDays)
                ->orderBy('failed_at')
                ->limit($limit)
                ->pluck('uuid')
                ->all()));
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: could not resolve a sweep scope', ['error' => $e->getMessage()]);

            return [];
        }
    }

    private function scoped(?string $queue, ?int $olderThanDays): Builder
    {
        $query = $this->query();

        if ($queue !== null && $queue !== '') {
            $query->where('queue', $queue);
        }

        if ($olderThanDays !== null) {
            $query->where('failed_at', '<', Carbon::now()->subDays($olderThanDays));
        }

        return $query;
    }

    /**
     * The subset of a selection that is actually in the table, in one query.
     *
     * @param list<string> $uuids
     *
     * @return list<string>
     */
    private function existing(array $uuids): array
    {
        $uuids = array_values(array_filter(
            array_unique(array_map('strval', $uuids)),
            fn (string $uuid) => $uuid !== '' && Str::lower($uuid) !== 'all',
        ));

        if ($uuids === [] || !$this->available()) {
            return [];
        }

        try {
            return array_values(array_map('strval', $this->query()->whereIn('uuid', $uuids)->pluck('uuid')->all()));
        } catch (\Throwable $e) {
            Log::warning('FailedJobRepository: could not resolve a selection', ['error' => $e->getMessage()]);

            return [];
        }
    }

    private function row(string $uuid): ?object
    {
        if (!$this->available()) {
            return null;
        }

        try {
            return $this->query()->where('uuid', $uuid)->first();
        } catch (\Throwable $e) {
            Log::debug('FailedJobRepository: could not read failed job', ['uuid' => $uuid, 'error' => $e->getMessage()]);

            return null;
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

        // displayName is what the worker itself logs, so it matches what an
        // operator would grep for. Fall back to the serialised command class.
        $job = (string) ($payload['displayName'] ?? ($payload['data']['commandName'] ?? 'Unknown job'));
        $described = $this->catalogue->describe($job);

        return [
            'uuid' => (string) $row->uuid,
            'job' => $job,
            // What the job actually is, for anyone who has not memorised the
            // namespace. The class stays on the row too -- it is what you grep
            // the log for, and it is the thing that is unambiguous.
            'title' => $described['title'],
            'summary' => $described['summary'],
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
     * Bounded and masked like the trace itself. This line is where an
     * interpolated query binding lands, so the cheap-looking one that rides
     * along with the list needs exactly the same treatment as the expensive one
     * behind the detail view.
     *
     * @return array{0: ?string, 1: string}
     */
    private function splitException(string $exception): array
    {
        $first = trim(strtok($exception, "\n") ?: '');
        $first = $this->redactor->redactText(Str::limit($first, self::MAX_MESSAGE_CHARS));

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

    private function query(): Builder
    {
        return DB::connection(config('queue.failed.database'))->table($this->table());
    }

    private function table(): string
    {
        return (string) config('queue.failed.table', 'failed_jobs');
    }
}
