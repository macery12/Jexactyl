<?php

namespace Everest\Console\Commands\Queue;

use Illuminate\Console\Command;
use Everest\Services\Queue\QueueHealthService;

class QueueHealthCommand extends Command
{
    /**
     * The name and signature of the console command.
     */
    protected $signature = 'p:queue:health {--json : Emit the raw snapshot as JSON}';

    /**
     * The console command description.
     */
    protected $description = 'Show queue depth, throughput, worker status, and anything wrong with the queue setup';

    /**
     * Execute the console command.
     */
    public function handle(QueueHealthService $health): int
    {
        // Always uncached: an operator running this wants the state now, not
        // whatever the dashboard last computed.
        $snapshot = $health->fresh();

        if ($this->option('json')) {
            $this->line((string) json_encode($snapshot, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

            return $this->exitCode($snapshot);
        }

        $this->renderWarnings($snapshot);
        $this->renderWorkers($snapshot);
        $this->renderLanes($snapshot);
        $this->renderJobs($snapshot);
        $this->renderFailed($snapshot);

        return $this->exitCode($snapshot);
    }

    /**
     * Non-zero when something is actually broken, so this is usable as a
     * monitoring check rather than only as a thing to read.
     */
    private function exitCode(array $snapshot): int
    {
        foreach ($snapshot['warnings'] as $warning) {
            if ($warning['severity'] === 'critical') {
                return self::FAILURE;
            }
        }

        return self::SUCCESS;
    }

    private function renderWarnings(array $snapshot): void
    {
        if ($snapshot['warnings'] === []) {
            $this->line(' <fg=green>✓</> Queue setup looks healthy.');
            $this->newLine();

            return;
        }

        foreach ($snapshot['warnings'] as $warning) {
            $critical = $warning['severity'] === 'critical';
            $this->line(($critical ? ' <fg=red>✗</> ' : ' <fg=yellow>!</> ') . $warning['message']);
        }

        $this->newLine();
    }

    private function renderWorkers(array $snapshot): void
    {
        $horizon = $snapshot['horizon'];

        $state = match (true) {
            !$horizon['running'] => '<fg=red>not running</>',
            $horizon['paused'] => '<fg=yellow>paused</>',
            default => '<fg=green>running</>',
        };

        $this->line("Horizon: {$state}   Connections: default=<comment>{$snapshot['defaultConnection']}</comment>, long=<comment>{$snapshot['longConnection']}</comment>");

        foreach ($horizon['supervisors'] as $supervisor) {
            $this->line("  <fg=gray>supervisor</> {$supervisor['name']} — {$supervisor['status']}, {$supervisor['processes']} process(es)");
        }

        foreach ($snapshot['workers'] as $worker) {
            $this->line("  <fg=gray>worker</> {$worker['host']}:{$worker['pid']} on [" . implode(',', $worker['queues']) . "] seen {$worker['seenAt']}");
        }

        $this->newLine();
    }

    private function renderLanes(array $snapshot): void
    {
        $this->table(
            ['Lane', 'Queue', 'Connection', 'Consumer', 'Depth', 'Wait', $this->processedHeading($snapshot), 'Avg run', 'retry_after'],
            array_map(fn (array $lane) => [
                $lane['lane'] . ($lane['long'] ? ' *' : ''),
                $lane['queue'],
                $lane['connection'],
                $this->consumerCell($lane),
                $lane['depth'] ?? '?',
                $lane['waitSeconds'] === null ? '—' : $lane['waitSeconds'] . 's',
                $lane['processed'] ?? '—',
                $this->ms($lane['avgRuntimeMs']),
                $lane['retryAfter'] ?? '—',
            ], $snapshot['lanes']),
        );

        $this->line('<fg=gray>* long-running lane — consumed only by a supervisor on the long connection.</>');
        $this->newLine();
    }

    private function consumerCell(array $lane): string
    {
        if ($lane['consumed']) {
            return '<fg=green>yes</>';
        }

        // A lane whose module is off is correctly unstaffed, not broken.
        return $lane['expected'] ? '<fg=red>NONE</>' : '<fg=gray>n/a</>';
    }

    private function renderJobs(array $snapshot): void
    {
        if ($snapshot['jobs'] === []) {
            return;
        }

        $this->table(
            ['Job', $this->processedHeading($snapshot), 'Avg run'],
            array_map(fn (array $job) => [
                class_basename($job['job']),
                $job['processed'] ?? '—',
                $this->ms($job['avgRuntimeMs']),
            ], array_slice($snapshot['jobs'], 0, 15)),
        );
    }

    /**
     * Throughput is a total over the retained metrics window, not a rate and not
     * an all-time count, so the heading says how far back it reaches.
     */
    private function processedHeading(array $snapshot): string
    {
        $minutes = $snapshot['metricsWindowMinutes'] ?? null;

        return $minutes === null ? 'Processed' : "Processed ({$minutes}m)";
    }

    private function renderFailed(array $snapshot): void
    {
        $failed = $snapshot['failed'];

        if ($failed['total'] === null) {
            $this->line('Failed jobs: <fg=gray>unavailable (no database failed-job store)</>');

            return;
        }

        $line = "Failed jobs: <comment>{$failed['total']}</comment> total, {$failed['lastDay']} in the last 24h";
        $this->line($failed['oldestFailedAt'] ? "{$line}, oldest {$failed['oldestFailedAt']}" : $line);
    }

    private function ms(int|float|null $value): string
    {
        // Horizon reports 0 for "never measured", which reads as "instant".
        if ($value === null || $value <= 0) {
            return '—';
        }

        return $value >= 1000 ? round($value / 1000, 1) . 's' : round($value) . 'ms';
    }
}
