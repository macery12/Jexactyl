<?php

namespace Everest\Services\Queue;

use Illuminate\Contracts\Config\Repository as Config;

/**
 * Resolves the panel's queue topology — which lanes exist, what each is
 * actually named, and which connection carries it.
 *
 * This is the single place that knows the short/long connection split. Jobs do
 * not name their own queue (see `config/queue.php` routing), the health
 * endpoint reads its lane list from here, and the routing test asserts against
 * it, so a lane added to config is picked up everywhere without further edits.
 */
class QueueTopology
{
    public function __construct(private Config $config)
    {
    }

    /**
     * Lane key => resolved queue name, in the order they are declared.
     *
     * @return array<string, string>
     */
    public function lanes(): array
    {
        return array_map(
            fn ($name) => (string) $name,
            $this->config->get('queue.lanes', [])
        );
    }

    /**
     * The resolved queue name for a lane, falling back to the lane key itself
     * so an unknown lane still produces something addressable rather than an
     * empty queue name.
     */
    public function queueFor(string $lane): string
    {
        return $this->lanes()[$lane] ?? $lane;
    }

    /**
     * The connection carrying a lane. Short lanes deliberately resolve to null
     * so they follow `QUEUE_CONNECTION` — pinning them to a literal would break
     * any operator who moves off the default driver.
     */
    public function connectionFor(string $lane): ?string
    {
        return $this->isLong($lane) ? $this->longConnection() : null;
    }

    /**
     * The connection a lane is *actually* consumed from, with the default
     * resolved. Use this for anything that has to talk to a driver.
     */
    public function resolvedConnectionFor(string $lane): string
    {
        return $this->connectionFor($lane) ?? $this->defaultConnection();
    }

    public function isLong(string $lane): bool
    {
        return in_array($lane, $this->config->get('queue.long_lanes', []), true);
    }

    /**
     * Whether this lane should currently have a worker consuming it.
     *
     * Some lanes only exist when a module is on -- `mods` is staffed by a
     * supervisor sized from the mods feature flag. Reporting an unstaffed
     * `mods` lane as a problem on an install that does not use mods would be a
     * permanent false alarm, and a warning nobody can act on is a warning
     * everybody learns to ignore.
     */
    public function isExpected(string $lane): bool
    {
        $flag = $this->config->get('queue.lane_requires', [])[$lane] ?? null;

        return $flag === null || (bool) $this->config->get($flag, false);
    }

    public function defaultConnection(): string
    {
        return (string) $this->config->get('queue.default');
    }

    /**
     * The connection used for long-running work.
     *
     * Explicit configuration wins; otherwise a `-long` sibling of the default
     * connection is used when one is defined. Everything else — `sync` under
     * test, `sqs` in production — falls back to the default connection, which
     * keeps those setups working with no per-driver special casing. The only
     * thing they lose is the longer `retry_after`.
     */
    public function longConnection(): string
    {
        $configured = $this->config->get('queue.long_connection');

        if (is_string($configured) && $configured !== '' && $this->connectionExists($configured)) {
            return $configured;
        }

        $default = $this->defaultConnection();
        $derived = $default . '-long';

        return $this->connectionExists($derived) ? $derived : $default;
    }

    /**
     * Job class => [connection, queue], in the shape `Queue::route()` expects.
     *
     * @return array<class-string, array{0: ?string, 1: string}>
     */
    public function routes(): array
    {
        $routes = [];

        foreach ($this->config->get('queue.routing', []) as $job => $lane) {
            $routes[$job] = [$this->connectionFor($lane), $this->queueFor($lane)];
        }

        return $routes;
    }

    /**
     * The queues and connections each Horizon supervisor must consume.
     *
     * Lane names and both queue connections are configurable, so Horizon must
     * resolve them through the same topology used for dispatch. Otherwise a
     * documented QUEUE_* override can send work to a queue no worker drains.
     *
     * @return array<string, array{connection: string, queue: list<string>}>
     */
    public function horizonSupervisors(): array
    {
        $interactive = [];

        foreach ($this->lanes() as $lane => $queue) {
            if (!$this->isLong($lane)) {
                $interactive[] = $queue;
            }
        }

        // Drain names used before the lane topology existed. De-duplicate the
        // standard lane when it still has its shipped name.
        $interactive = array_values(array_unique(array_merge($interactive, ['high', 'low', 'standard'])));

        return [
            'supervisor-interactive' => [
                'connection' => $this->defaultConnection(),
                'queue' => $interactive,
            ],
            'supervisor-mods' => [
                'connection' => $this->longConnection(),
                'queue' => [$this->queueFor('mods')],
            ],
            'supervisor-agent' => [
                'connection' => $this->longConnection(),
                'queue' => [$this->queueFor('agent')],
            ],
        ];
    }

    /**
     * The lane a job class is routed to, or null when it falls through to the
     * connection default.
     */
    public function laneForJob(string $job): ?string
    {
        return $this->config->get('queue.routing', [])[$job] ?? null;
    }

    /**
     * The lane a resolved queue *name* belongs to. Used when reading back from
     * the driver or from a job event, where only the name is available.
     */
    public function laneForQueue(string $queue): ?string
    {
        $lane = array_search($queue, $this->lanes(), true);

        return $lane === false ? null : $lane;
    }

    /**
     * `retry_after` for the connection carrying a lane. Null on drivers that do
     * not use it (`sync`, `sqs` — the latter uses a visibility timeout set on
     * the queue itself).
     */
    public function retryAfterFor(string $lane): ?int
    {
        $after = $this->config->get(
            'queue.connections.' . $this->resolvedConnectionFor($lane) . '.retry_after'
        );

        return is_numeric($after) ? (int) $after : null;
    }

    private function connectionExists(string $connection): bool
    {
        return is_array($this->config->get('queue.connections.' . $connection));
    }
}
