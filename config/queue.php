<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Default Queue Connection Name
    |--------------------------------------------------------------------------
    |
    | Laravel's queue API supports an assortment of back-ends via a single
    | API, giving you convenient access to each back-end using the same
    | syntax for every one. Here you may define a default connection.
    |
    */

    'default' => env('QUEUE_CONNECTION', env('QUEUE_DRIVER', 'redis')),

    /*
    |--------------------------------------------------------------------------
    | Long-Running Connection
    |--------------------------------------------------------------------------
    |
    | `retry_after` is a property of a *connection*, not of a queue. A single
    | connection therefore has to set it above the longest job it carries, and
    | a modpack install runs for an hour — which is why this used to be 3900
    | for everything, and why a worker killed mid-way through a 60-second job
    | stayed invisible for 65 minutes.
    |
    | So there are two tiers over the same backend. Everything interactive
    | lives on the default connection with a short `retry_after`; only the
    | genuinely long workloads use this one. When the derived connection does
    | not exist (`sync` under test, `sqs` in production) the provider falls
    | back to the default connection, so nothing has to be special-cased.
    |
    | @see \Everest\Services\Queue\QueueTopology::longConnection()
    |
    */

    'long_connection' => env('QUEUE_LONG_CONNECTION'),

    /*
    |--------------------------------------------------------------------------
    | Queue Connections
    |--------------------------------------------------------------------------
    |
    | Here you may configure the connection information for each server that
    | is used by your application. A default configuration has been added
    | for each back-end shipped with Laravel. You are free to add more.
    |
    | The `-long` variants are identical to their base connection apart from
    | `retry_after`. Keep every other option in sync between the pair.
    |
    */

    'connections' => [
        'sync' => [
            'driver' => 'sync',
        ],

        'database' => [
            'driver' => 'database',
            'table' => 'jobs',
            'queue' => env('QUEUE_STANDARD', 'standard'),
            'retry_after' => (int) env('QUEUE_RETRY_AFTER', 300),
            'after_commit' => true,
        ],

        'database-long' => [
            'driver' => 'database',
            'table' => 'jobs',
            'queue' => env('QUEUE_MODS', 'mods'),
            'retry_after' => (int) env('QUEUE_LONG_RETRY_AFTER', 3900),
            'after_commit' => true,
        ],

        'sqs' => [
            'driver' => 'sqs',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id'),
            'queue' => env('SQS_QUEUE', env('QUEUE_STANDARD', 'standard')),
            'suffix' => env('SQS_SUFFIX'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'after_commit' => true,
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('REDIS_QUEUE', env('QUEUE_STANDARD', 'standard')),
            'retry_after' => (int) env('QUEUE_RETRY_AFTER', 300),

            // Blocking pop rather than polling. With `--sleep=3` a schedule tick
            // could sit for three seconds before a worker noticed it; blocking for
            // one second removes that without busy-looping on Redis.
            //
            // predis (this panel ships predis, not the phpredis extension) aborts
            // when `block_for` meets or exceeds the connection's read_write_timeout,
            // so keep this comfortably below `config('database.redis.options')`.
            'block_for' => (int) env('QUEUE_BLOCK_FOR', 1),
            'after_commit' => true,
        ],

        'redis-long' => [
            'driver' => 'redis',
            'connection' => 'default',
            'queue' => env('QUEUE_MODS', 'mods'),
            'retry_after' => (int) env('QUEUE_LONG_RETRY_AFTER', 3900),
            'block_for' => (int) env('QUEUE_BLOCK_FOR', 1),
            'after_commit' => true,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Workload Lanes
    |--------------------------------------------------------------------------
    |
    | One worker draining one queue means an hour-long modpack install gives
    | every other class of work zero capacity. These lanes exist so unrelated
    | workloads can be consumed by separate worker processes.
    |
    | Which supervisor consumes which lane is config/horizon.php's business;
    | this file only says the lanes exist and what they are called.
    |
    | `high` and `low` are legacy: the old single systemd unit passed
    | `--queue=high,standard,low` even though nothing ever dispatched to them.
    | They are absent here because nothing routes to them, but the interactive
    | supervisor still drains them so anything queued before the split runs.
    |
    | Changing a lane's *name* is safe; removing a lane is not, unless the
    | Horizon supervisors are updated to drain it first.
    |
    */

    'lanes' => [
        'critical' => env('QUEUE_CRITICAL', 'critical'),
        'schedules' => env('QUEUE_SCHEDULES', 'schedules'),
        'mail' => env('QUEUE_MAIL', 'mail'),
        'dns' => env('QUEUE_DNS', 'dns'),
        'mods' => env('QUEUE_MODS', 'mods'),
        'agent' => env('QUEUE_AGENT', 'agent'),
        'standard' => env('QUEUE_STANDARD', 'standard'),
    ],

    /*
    | Lanes carried by the long-running connection. A lane listed here must
    | only ever be consumed by a worker started against that connection — a
    | worker on the short connection would migrate its reservations after the
    | short `retry_after` and hand a still-running job to a second worker.
    */

    'long_lanes' => ['mods', 'agent'],

    /*
    | Lanes that only need a worker when a module is switched on. The mods
    | supervisor is sized to zero processes when mods are disabled, so the admin
    | queue page must not then report the lane as unstaffed -- it is correctly
    | unstaffed.
    |
    | Lane key => config flag that must be truthy for the lane to be expected.
    */

    'lane_requires' => [
        'mods' => 'modules.mods.enabled',

        // Durable agent turns, not the agent itself. On an install that has
        // deliberately switched execution back to request-bound, nothing is ever
        // dispatched here and an unstaffed lane is the correct state rather
        // than a fault to report.
        'agent' => 'modules.ai.agent.durable',
    ],

    /*
    |--------------------------------------------------------------------------
    | Job Routing
    |--------------------------------------------------------------------------
    |
    | Job class => lane key. Registered through `Queue::route()` so a job never
    | has to know its own queue, and so the whole topology is auditable here
    | rather than spread across constructors.
    |
    | Careful: `Queue::route()` is only consulted when the job has no queue of
    | its own. Assigning `$this->queue` in a constructor silently wins over
    | this map — see Illuminate\Support\Traits\ReadsClassAttributes. The
    | QueueTopologyTest asserts no job does that.
    |
    | Anything unrouted falls through to the default connection's queue
    | (`standard`), which is what extension-provided jobs get.
    |
    */

    'routing' => [
        Everest\Jobs\Billing\GenerateInvoiceJob::class => 'critical',

        Everest\Jobs\Schedule\RunTaskJob::class => 'schedules',

        Everest\Jobs\Email\SendEmailJob::class => 'mail',
        Everest\Jobs\Email\ProcessDeferredEmailsJob::class => 'mail',

        Everest\Jobs\CustomDomains\ProvisionServerCustomDomainsJob::class => 'dns',
        Everest\Jobs\CustomDomains\ProvisionCustomDomainRecordJob::class => 'dns',
        Everest\Jobs\CustomDomains\CleanupServerCustomDomainsJob::class => 'dns',

        Everest\Jobs\InstallModpackJob::class => 'mods',
        Everest\Jobs\DownloadModJob::class => 'mods',

        Everest\Jobs\AI\RunAgentTurnJob::class => 'agent',
    ],

    /*
    |--------------------------------------------------------------------------
    | Lane Descriptions
    |--------------------------------------------------------------------------
    |
    | What each lane is *for*, in an operator's words. The admin queue page
    | reads these so a lane is not just a key: `mods` on its own says nothing
    | about why it is allowed to be an hour behind.
    |
    | Keyed by lane, so renaming the queue a lane resolves to (QUEUE_MODS) does
    | not orphan the description.
    |
    */

    'lane_meta' => [
        'critical' => [
            'title' => 'Billing & invoices',
            'summary' => 'Work that must not wait behind anything bulk. Processed in strict priority order.',
        ],
        'schedules' => [
            'title' => 'Server schedules',
            'summary' => 'Scheduled power actions, console commands and backups.',
        ],
        'mail' => [
            'title' => 'Outbound email',
            'summary' => 'Queued messages and the deferred-send flush.',
        ],
        'dns' => [
            'title' => 'Custom domains',
            'summary' => 'DNS records for server custom domains, rate limited per provider.',
        ],
        'mods' => [
            'title' => 'Modpack installs',
            'summary' => 'Modpack and mod downloads. A single job here legitimately runs for hours.',
        ],
        'agent' => [
            'title' => 'AI assistant turns',
            'summary' => 'Durable assistant turns and their tool calls. Never retried automatically.',
        ],
        'standard' => [
            'title' => 'Everything else',
            'summary' => 'Unrouted work, including jobs dispatched by extensions.',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Supervisor Descriptions
    |--------------------------------------------------------------------------
    |
    | Horizon supervisors named for what they do. The admin page groups worker
    | processes under these, because `supervisor-mods` with one PID under it is
    | not something an operator should have to decode -- and a flat list of
    | six anonymous PIDs is exactly what the page used to show.
    |
    | Keys must match the supervisor names in QueueTopology::horizonSupervisors().
    |
    */

    'supervisor_meta' => [
        'supervisor-interactive' => [
            'title' => 'Interactive work',
            'summary' => 'Everything a person is waiting on: invoices, schedules, mail and DNS.',
        ],
        'supervisor-mods' => [
            'title' => 'Modpack installs',
            'summary' => 'One process on the long connection. A job here may legitimately run for hours.',
        ],
        'supervisor-agent' => [
            'title' => 'AI assistant turns',
            'summary' => 'Sized to the inference concurrency the AI gate already enforces.',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Job Catalogue
    |--------------------------------------------------------------------------
    |
    | Job class => what it is, for anywhere a human reads a job name: the admin
    | queue page, the failed-job list, `p:queue:health`. Without it the only
    | thing those surfaces can show is the FQCN, which tells an operator
    | nothing about what re-running it would actually do.
    |
    | Anything absent falls back to a prettified class basename, so an
    | extension's job still reads as "Sync billing" rather than as a namespace.
    | Extensions may add entries by merging into this key from their own
    | service provider.
    |
    | Keep `summary` to one sentence, in the present tense, describing the
    | effect of the job running -- that sentence is what an admin reads before
    | deciding whether to press Retry.
    |
    */

    'catalogue' => [
        Everest\Jobs\Billing\GenerateInvoiceJob::class => [
            'title' => 'Generate invoice',
            'summary' => 'Bills a subscription period and writes the invoice record.',
        ],

        Everest\Jobs\Schedule\RunTaskJob::class => [
            'title' => 'Run scheduled task',
            'summary' => 'Runs one step of a server schedule -- a power action, console command or backup -- and queues the next step.',
        ],

        Everest\Jobs\Email\SendEmailJob::class => [
            'title' => 'Send email',
            'summary' => 'Delivers one queued message through the configured mail transport.',
        ],
        Everest\Jobs\Email\ProcessDeferredEmailsJob::class => [
            'title' => 'Flush deferred email',
            'summary' => 'Releases messages held back by the deferred-send window.',
        ],

        Everest\Jobs\CustomDomains\ProvisionServerCustomDomainsJob::class => [
            'title' => 'Provision custom domains',
            'summary' => 'Creates the DNS records for every custom domain on a server.',
        ],
        Everest\Jobs\CustomDomains\ProvisionCustomDomainRecordJob::class => [
            'title' => 'Provision domain record',
            'summary' => 'Creates or updates one DNS record at the domain provider.',
        ],
        Everest\Jobs\CustomDomains\CleanupServerCustomDomainsJob::class => [
            'title' => 'Remove custom domains',
            'summary' => 'Deletes the DNS records left behind by a removed server or domain.',
        ],

        Everest\Jobs\InstallModpackJob::class => [
            'title' => 'Install modpack',
            'summary' => 'Downloads and unpacks a modpack onto a server. Runs for minutes to hours.',
        ],
        Everest\Jobs\DownloadModJob::class => [
            'title' => 'Download mod',
            'summary' => "Fetches a single mod file into a server's mod directory.",
        ],

        Everest\Jobs\AI\RunAgentTurnJob::class => [
            'title' => 'Run AI assistant turn',
            'summary' => 'Executes one durable assistant turn, including its tool calls.',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Failed Queue Jobs
    |--------------------------------------------------------------------------
    |
    | These options configure the behavior of failed queue job logging so you
    | can control which database and table are used to store the jobs that
    | have failed. You may change them to any database / table you wish.
    |
    */

    'failed' => [
        'driver' => env('QUEUE_FAILED_DRIVER', 'database-uuids'),
        'database' => env('DB_CONNECTION', 'mysql'),
        'table' => 'failed_jobs',
    ],
];
