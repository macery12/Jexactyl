<?php

namespace Everest\Services\Queue;

use Illuminate\Contracts\Config\Repository as Config;
use Illuminate\Contracts\Cache\Repository as CacheRepository;

/**
 * Checks that this install can actually run Horizon.
 *
 * Horizon is the panel's only process manager, and it supervises Redis queues
 * exclusively. Started against a database or SQS queue, against a clustered
 * Redis, or on a host without pcntl, it comes up clean and then processes
 * nothing at all -- no error, no jobs, until somebody notices that invoices
 * stopped going out.
 *
 * So the worker refuses to start instead, and the same findings are surfaced on
 * the admin queue page for anyone who has already got themselves into that
 * state.
 */
class HorizonEnvironmentGuard
{
    /** The functions Horizon's master supervisor calls to fork and signal workers. */
    private const REQUIRED_FUNCTIONS = ['pcntl_fork', 'pcntl_signal', 'pcntl_alarm', 'posix_kill', 'posix_getpid'];

    /** Last observation of the above, made by (and only by) a CLI process. */
    private const CAPABILITY_KEY = 'queue:env:worker-functions-missing';
    private const CAPABILITY_TTL = 604800;

    /**
     * $sapi is injectable purely so the web-request path is testable; the test
     * suite itself only ever runs under CLI.
     */
    public function __construct(
        private Config $config,
        private ?CacheRepository $cache = null,
        private string $sapi = PHP_SAPI,
    ) {
    }

    /**
     * Everything preventing Horizon from working here, worst first. Empty means
     * no known problem -- see checkExtensions() for the one thing a web request
     * cannot answer about itself.
     *
     * @return list<array{code: string, problem: string, fix: string}>
     */
    public function problems(): array
    {
        return array_values(array_filter([
            $this->checkDriver(),
            $this->checkCluster(),
            $this->checkExtensions(),
            $this->checkLongConnection(),
        ]));
    }

    public function isSupported(): bool
    {
        return $this->problems() === [];
    }

    /**
     * Horizon only understands the Redis driver. On any other queue connection
     * the supervisor starts and sits idle forever.
     */
    private function checkDriver(): ?array
    {
        $connection = $this->config->get('queue.default');
        $driver = $this->config->get("queue.connections.{$connection}.driver");

        if ($driver === 'redis') {
            return null;
        }

        return [
            'code' => 'queue_driver',
            'problem' => "QUEUE_CONNECTION is [{$connection}], which uses the [{$driver}] driver. Horizon can only supervise Redis queues, so no jobs would be processed.",
            'fix' => 'Set QUEUE_CONNECTION=redis in .env and restart the panel.',
        ];
    }

    /**
     * Horizon does not support Redis Cluster. Note that `database.redis.options.cluster`
     * being set is not the test -- that key names the clustering *strategy* and
     * is populated by default. Clustering is only actually in use when the
     * connection is defined under a `clusters` block.
     */
    private function checkCluster(): ?array
    {
        $connection = $this->config->get('queue.default');
        $redisConnection = $this->config->get("queue.connections.{$connection}.connection", 'default');

        if (!is_array($this->config->get("database.redis.clusters.{$redisConnection}"))) {
            return null;
        }

        return [
            'code' => 'redis_cluster',
            'problem' => "Redis connection [{$redisConnection}] is configured as a cluster. Horizon does not support Redis Cluster.",
            'fix' => 'Point the queue at a single (non-clustered) Redis instance.',
        ];
    }

    /**
     * The master supervisor forks and signals its workers.
     *
     * The subtlety: this must describe the CLI binary, because that is what runs
     * Horizon -- and it is never the process asking. Debian and Ubuntu compile
     * pcntl into the CLI SAPI only (there is no pcntl.so to load), so a web
     * request always finds pcntl_fork missing, on a host where the worker has it
     * and is running perfectly. Probing the current process would report that
     * healthy install as broken and send the operator hunting through a
     * disable_functions list that is empty.
     *
     * So the probe runs under CLI, where the answer means something, and records
     * it. Anything else reads the recording back, and stays quiet when there
     * isn't one rather than guessing.
     */
    private function checkExtensions(): ?array
    {
        $missing = $this->sapi === 'cli' ? $this->probeAndRecord() : $this->recall();

        if ($missing === null || $missing === []) {
            return null;
        }

        return [
            'code' => 'missing_functions',
            'problem' => 'The PHP CLI binary is missing functions Horizon needs to supervise workers: ' . implode(', ', $missing) . '.',
            'fix' => 'Install the pcntl and posix extensions for the CLI SAPI (confirm with `php -m`), and check they are not listed in disable_functions in the CLI php.ini. These are only needed by the CLI binary, not by PHP-FPM.',
        ];
    }

    /**
     * @return list<string>
     */
    private function probeAndRecord(): array
    {
        $missing = array_values(array_filter(
            self::REQUIRED_FUNCTIONS,
            fn (string $function) => !function_exists($function)
        ));

        // Re-recorded on every worker start and every `p:queue:health`, so a
        // host that gets fixed clears itself without anyone flushing a cache.
        try {
            $this->cache?->put(self::CAPABILITY_KEY, $missing, self::CAPABILITY_TTL);
        } catch (\Throwable) {
            // An unreachable cache must never stop a worker from starting.
        }

        return $missing;
    }

    /**
     * The last CLI observation, or null when there has not been one -- which is
     * not the same as "nothing is missing" and must not be reported as a finding.
     *
     * @return list<string>|null
     */
    private function recall(): ?array
    {
        try {
            $recalled = $this->cache?->get(self::CAPABILITY_KEY);
        } catch (\Throwable) {
            return null;
        }

        return is_array($recalled) ? array_values(array_filter($recalled, 'is_string')) : null;
    }

    /**
     * Modpack installs run for up to an hour on a connection with a matching
     * retry_after. Without it they would land on the default connection, whose
     * reservation expires five minutes in -- and a second worker would start
     * installing the same pack.
     */
    private function checkLongConnection(): ?array
    {
        $long = $this->config->get('horizon.defaults.supervisor-mods.connection');

        if ($long === null || is_array($this->config->get("queue.connections.{$long}"))) {
            return null;
        }

        return [
            'code' => 'missing_long_connection',
            'problem' => "The mods supervisor is configured for queue connection [{$long}], which is not defined in config/queue.php.",
            'fix' => 'Restore the long-running connection, or point supervisor-mods at one whose retry_after exceeds the modpack install timeout.',
        ];
    }
}
