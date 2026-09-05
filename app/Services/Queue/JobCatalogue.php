<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Str;
use Illuminate\Contracts\Config\Repository as Config;

/**
 * Turns a job class into something a human can read.
 *
 * Every surface that shows queue work — the admin page, the failed-job list,
 * `p:queue:health` — otherwise has nothing to display but the FQCN, and
 * `Everest\Jobs\Schedule\RunTaskJob` does not tell an operator what pressing
 * Retry would actually do. The descriptions live in `config/queue.php`
 * alongside the routing map, so the whole topology stays auditable in one file.
 *
 * Unknown classes are not an error. Extensions dispatch their own jobs, and an
 * uncatalogued job still resolves to a prettified basename — "Sync billing"
 * rather than a namespace — so the page degrades to something readable instead
 * of to nothing.
 */
class JobCatalogue
{
    /** @var array<string, array{key: string, class: string, title: string, summary: ?string, lane: ?string, known: bool}> */
    private array $resolved = [];

    public function __construct(private Config $config, private QueueTopology $topology)
    {
    }

    /**
     * Describe one job.
     *
     * Accepts anything that identifies a job: a class-string, or the worker's
     * own `displayName` — which is the class for every job the panel
     * dispatches, but is free text in principle, so a name that resolves to
     * nothing is passed through rather than mangled.
     *
     * @return array{key: string, class: string, title: string, summary: ?string, lane: ?string, known: bool}
     */
    public function describe(string $job): array
    {
        $job = trim($job);

        if ($job === '') {
            return $this->unknown('Unknown job');
        }

        return $this->resolved[$job] ??= $this->build($job);
    }

    /**
     * Every catalogued job, for the admin page's job-type list.
     *
     * @return list<array{key: string, class: string, title: string, summary: ?string, lane: ?string, known: bool}>
     */
    public function all(): array
    {
        return array_values(array_map(
            fn (string $class) => $this->describe($class),
            array_keys($this->entries())
        ));
    }

    /**
     * What a lane is for, in an operator's words.
     *
     * Keyed by lane rather than by resolved queue name, so renaming a queue
     * through QUEUE_MODS does not orphan the description.
     *
     * @return array{title: string, summary: ?string}
     */
    public function describeLane(string $lane): array
    {
        $meta = $this->config->get('queue.lane_meta', [])[$lane] ?? null;

        if (is_array($meta)) {
            return [
                'title' => (string) ($meta['title'] ?? Str::headline($lane)),
                'summary' => isset($meta['summary']) ? (string) $meta['summary'] : null,
            ];
        }

        // A lane an operator added to config without a description is still a
        // lane; headline the key rather than showing nothing.
        return ['title' => Str::headline($lane), 'summary' => null];
    }

    /**
     * @return array{key: string, class: string, title: string, summary: ?string, lane: ?string, known: bool}
     */
    private function build(string $job): array
    {
        $entry = $this->entries()[$job] ?? null;

        if (!is_array($entry)) {
            return $this->unknown($job);
        }

        return [
            'key' => $this->keyFor($job),
            'class' => $job,
            'title' => (string) ($entry['title'] ?? $this->prettify($job)),
            'summary' => isset($entry['summary']) ? (string) $entry['summary'] : null,
            'lane' => $this->topology->laneForJob($job),
            'known' => true,
        ];
    }

    /**
     * @return array{key: string, class: string, title: string, summary: ?string, lane: ?string, known: bool}
     */
    private function unknown(string $job): array
    {
        return [
            'key' => $this->keyFor($job),
            'class' => $job,
            'title' => $this->prettify($job),
            'summary' => null,
            'lane' => $this->topology->laneForJob($job),
            'known' => false,
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function entries(): array
    {
        $catalogue = $this->config->get('queue.catalogue', []);

        return is_array($catalogue) ? $catalogue : [];
    }

    /**
     * A stable identifier for a job that is safe in a URL and in a message key,
     * so the frontend can key off something other than a backslashed FQCN.
     */
    private function keyFor(string $job): string
    {
        $trimmed = Str::after($job, 'Everest\\Jobs\\');
        $parts = explode('\\', $trimmed);

        // Only the class itself loses its "Job" suffix. Stripping it from every
        // segment turns an extension's `Acme\Jobs\SyncBillingJob` into
        // `acme.s.sync_billing`, because the `Jobs` namespace ends in one too.
        $last = array_key_last($parts);
        $parts[$last] = $this->stripJobSuffix($parts[$last]);

        $key = collect($parts)
            // An acronym segment is lowercased whole: Str::snake('AI') gives
            // 'a_i', which is not a name anyone would recognise.
            ->map(fn (string $part) => $part === Str::upper($part) ? Str::lower($part) : Str::snake($part))
            ->filter()
            ->implode('.');

        return $key !== '' ? $key : Str::snake(class_basename($job));
    }

    /**
     * Drop a trailing "Job" -- every one of them has it, so it carries no
     * information -- without eating the "s" off a `Jobs` namespace segment or
     * emptying a class that is called exactly `Job`.
     */
    private function stripJobSuffix(string $name): string
    {
        if (!str_ends_with($name, 'Job') || $name === 'Job') {
            return $name;
        }

        return substr($name, 0, -3);
    }

    /**
     * "Everest\Jobs\Schedule\RunTaskJob" => "Run task".
     *
     * The trailing "Job" goes because every one of them has it, so it carries
     * no information and costs a word in a column that is already tight.
     */
    private function prettify(string $job): string
    {
        $base = $this->stripJobSuffix(class_basename($job));

        return $base === '' ? $job : Str::ucfirst(Str::lower(Str::headline($base)));
    }
}
