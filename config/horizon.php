<?php

use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| Horizon supervises the panel's queue workers
|--------------------------------------------------------------------------
|
| The panel runs one process manager -- `php artisan horizon` -- and the
| worker topology lives here rather than in systemd units. That is deliberate:
| adding or resizing a lane ships as a config change, instead of asking every
| operator to hand-edit unit files on upgrade.
|
| Horizon requires a non-clustered Redis queue and the pcntl/posix extensions.
| Everest\Providers\QueueServiceProvider refuses to boot the worker if those
| are missing, rather than letting a supervisor start and quietly process
| nothing. See docs/queues.md.
|
| Job *routing* is not configured here -- Horizon supervises workers, it does
| not decide which queue a job lands on. That map is in config/queue.php.
|
*/

return [
    /*
    | Horizon's own bookkeeping. A distinct prefix matters here: cache, cache
    | locks, the queue itself and broadcasting all share Redis database 0, and
    | so do the AI admission locks in InferenceGate.
    */

    'prefix' => env('HORIZON_PREFIX', Str::slug(env('APP_NAME', 'Everest'), '_') . '_horizon:'),

    'use' => env('HORIZON_REDIS_CONNECTION', 'default'),

    /*
    | The panel does not expose Horizon's own dashboard. Queue health is served
    | by /admin/queues, which reads Horizon's repositories and renders them in
    | the panel's own UI -- one admin surface, one theme, one set of
    | permissions. The route stays registered but admits nobody unless an
    | operator deliberately widens the `viewHorizon` gate.
    */

    'domain' => env('HORIZON_DOMAIN'),
    'path' => env('HORIZON_PATH', 'horizon'),
    'middleware' => ['web'],

    /*
    | Seconds a job may wait before it counts as a long wait. Tightest on the
    | lanes a human is actually waiting on; mods is generous because a modpack
    | install queued behind another one is normal.
    */

    'waits' => [
        'redis:critical' => 30,
        'redis:schedules' => 60,
        'redis:mail' => 60,
        'redis:dns' => 300,
        'redis:standard' => 300,
        'redis:high' => 60,
        'redis:low' => 600,
        'redis-long:mods' => 900,
    ],

    'trim' => [
        'recent' => 60,
        'pending' => 60,
        'completed' => 60,
        'recent_failed' => 10080,
        'failed' => 10080,
        'monitored' => 10080,
    ],

    'silenced' => [],

    'metrics' => [
        'trim_snapshots' => [
            'job' => 24,
            'queue' => 24,
        ],
    ],

    'fast_termination' => false,

    'memory_limit' => 64,

    'defaults' => [
        /*
        | Everything a human waits on.
        |
        | `balance => false` is load-bearing. Under the `auto` strategy Horizon
        | explicitly ignores the order queues are listed in, which would make
        | the `critical` lane meaningless. `false` processes them in strict
        | order -- invoices before schedules before mail before DNS -- while
        | still scaling processes up when work accumulates.
        |
        | `high` and `low` are legacy lanes. Nothing routes to them; they are
        | listed only so anything queued there before the split still drains.
        |
        | timeout must stay below the connection's retry_after (300), or a job
        | could be handed to a second worker while the first still has it.
        */
        'supervisor-interactive' => [
            'connection' => 'redis',
            'queue' => ['critical', 'schedules', 'mail', 'dns', 'standard', 'high', 'low'],
            'balance' => false,
            'minProcesses' => 1,
            'maxProcesses' => 6,
            'balanceMaxShift' => 1,
            'balanceCooldown' => 3,
            'maxTime' => 3600,
            'maxJobs' => 0,
            'memory' => 256,
            'tries' => 3,
            'timeout' => 240,
            'nice' => 0,
        ],

        /*
        | Modpack and mod installs, isolated because a single one of them can
        | run for an hour. This is the whole point of the split: without it, one
        | install starves invoices, mail, and every scheduled server task.
        |
        | Sized from the mods feature flag, so an install with the module off
        | spends no processes on a lane that can never receive work. Turning the
        | module on and restarting Horizon is all it takes to staff it.
        |
        | The value here is only a floor. It is set for real by
        | QueueServiceProvider once the app has finished booting, because the
        | mods flag can be toggled by an admin at runtime and that override is
        | layered onto config *after* this file has been evaluated -- reading
        | env() here would staff zero processes on an install that has mods
        | switched on in the panel.
        |
        | The connection matters as much as the isolation. `redis-long` carries
        | retry_after 3900; on the default connection the reservation would
        | expire five minutes into a running install and a second worker would
        | pick it up.
        |
        | Horizon force-kills workers it considers hung after `timeout`, so this
        | must not be below the job's own 3600.
        */
        'supervisor-mods' => [
            'connection' => 'redis-long',
            'queue' => ['mods'],
            'balance' => 'simple',
            'processes' => 0,
            'maxTime' => 3600,
            'maxJobs' => 0,
            'memory' => 512,
            'tries' => 3,
            'timeout' => 3600,
            'nice' => 5,
        ],
    ],

    'environments' => [
        'production' => [
            'supervisor-interactive' => ['maxProcesses' => 6],
            'supervisor-mods' => [],
        ],

        'local' => [
            'supervisor-interactive' => ['maxProcesses' => 3],
            'supervisor-mods' => [],
        ],

        // Staging and any custom APP_ENV, so an unexpected environment gets
        // workers rather than silence.
        '*' => [
            'supervisor-interactive' => ['maxProcesses' => 3],
            'supervisor-mods' => [],
        ],
    ],
];
