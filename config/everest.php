<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Restricted Environment
    |--------------------------------------------------------------------------
    |
    | Set this environment variable to true to enable a restricted configuration
    | setup on the panel. When set to true, configurations stored in the
    | database will not be applied.
    */

    'load_environment_only' => (bool) env('APP_ENVIRONMENT_ONLY', false),

    /*
    |--------------------------------------------------------------------------
    | Service Author
    |--------------------------------------------------------------------------
    |
    | Each panel installation is assigned a unique UUID to identify the
    | author of custom services, and make upgrades easier by identifying
    | standard Pterodactyl shipped services.
    */

    'service' => [
        'author' => env('APP_SERVICE_AUTHOR', 'unknown@unknown.com'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Authentication
    |--------------------------------------------------------------------------
    |
    | Should login success and failure events trigger an email to the user?
    */

    'auth' => [
        '2fa_required' => env('APP_2FA_REQUIRED', 0),
        '2fa' => [
            'bytes' => 32,
            // Google2FA scans t-window..t+window, so this is (2 * window) + 1
            // simultaneously valid 30-second codes. The default was 4, i.e. 9 codes
            // over a ~4.5 minute band; 1 gives the conventional 3 codes / 90s and
            // cuts the online-guessing surface by two thirds.
            'window' => env('APP_2FA_WINDOW', 1),
            'verify_newer' => true,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Pagination
    |--------------------------------------------------------------------------
    |
    | Certain pagination result counts can be configured here and will take
    | effect globally.
    */

    'paginate' => [
        'frontend' => [
            'servers' => env('APP_PAGINATE_FRONT_SERVERS', 15),
        ],
        'admin' => [
            'servers' => env('APP_PAGINATE_ADMIN_SERVERS', 25),
            'users' => env('APP_PAGINATE_ADMIN_USERS', 25),
        ],
        'api' => [
            'nodes' => env('APP_PAGINATE_API_NODES', 25),
            'servers' => env('APP_PAGINATE_API_SERVERS', 25),
            'users' => env('APP_PAGINATE_API_USERS', 25),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Guzzle Connections
    |--------------------------------------------------------------------------
    |
    | Configure the timeout to be used for Guzzle connections here.
    */

    'guzzle' => [
        'timeout' => env('GUZZLE_TIMEOUT', 15),
        'connect_timeout' => env('GUZZLE_CONNECT_TIMEOUT', 5),
    ],

    /*
    |--------------------------------------------------------------------------
    | Wings Daemon
    |--------------------------------------------------------------------------
    |
    | Controls how the panel talks to Wings daemons. `verify_tls` decides whether
    | the daemon's TLS certificate is verified on every request. It is an explicit
    | flag rather than an implicit environment check; when WINGS_VERIFY_TLS is
    | unset it falls back to the historical behavior of verifying only in
    | production, so installs using self-signed daemon certs in local/staging are
    | unaffected until they opt in.
    */

    'wings' => [
        'verify_tls' => env('WINGS_VERIFY_TLS', env('APP_ENV', 'production') === 'production'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Releases
    |--------------------------------------------------------------------------
    |
    | GitHub "latest release" endpoint used for the update check. When the
    | repository has no published releases (or the feed is unreachable) the
    | panel quietly reports itself as up to date.
    */

    'releases' => [
        'cache_time' => 60,
        'url' => env('RELEASES_URL', 'https://api.github.com/repos/macery12/m12labs/releases/latest'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Client Features
    |--------------------------------------------------------------------------
    |
    | Allow clients to create their own databases.
    */

    'client_features' => [
        'databases' => [
            'enabled' => env('PTERODACTYL_CLIENT_DATABASES_ENABLED', true),
            'allow_random' => env('PTERODACTYL_CLIENT_DATABASES_ALLOW_RANDOM', true),
        ],

        'schedules' => [
            // The total number of tasks that can exist for any given schedule at once.
            'per_schedule_task_limit' => env('PTERODACTYL_PER_SCHEDULE_TASK_LIMIT', 10),
        ],

        'allocations' => [
            'enabled' => env('PTERODACTYL_CLIENT_ALLOCATIONS_ENABLED', true),
            'range_start' => env('PTERODACTYL_CLIENT_ALLOCATIONS_RANGE_START'),
            'range_end' => env('PTERODACTYL_CLIENT_ALLOCATIONS_RANGE_END'),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | File Editor
    |--------------------------------------------------------------------------
    |
    | This array includes the MIME filetypes that can be edited via the web.
    */

    'files' => [
        'max_edit_size' => env('PTERODACTYL_FILES_MAX_EDIT_SIZE', 1024 * 1024 * 4),
    ],

    /*
    |--------------------------------------------------------------------------
    | Dynamic Environment Variables
    |--------------------------------------------------------------------------
    |
    | Place dynamic environment variables here that should be auto-appended
    | to server environment fields when the server is created or updated.
    |
    | Items should be in 'key' => 'value' format, where key is the environment
    | variable name, and value is the server-object key. For example:
    |
    | 'P_SERVER_CREATED_AT' => 'created_at'
    */

    'environment_variables' => [
        'P_SERVER_ALLOCATION_LIMIT' => 'allocation_limit',
    ],

    /*
    |--------------------------------------------------------------------------
    | Asset Verification
    |--------------------------------------------------------------------------
    |
    | This section controls the output format for JS & CSS assets.
    */

    'assets' => [
        'use_hash' => env('PTERODACTYL_USE_ASSET_HASH', false),
    ],

    /*
    |--------------------------------------------------------------------------
    | Wings-RS Self-Upgrade
    |--------------------------------------------------------------------------
    |
    | Wings-RS requires a restart command in its upgrade payload and spawns it
    | verbatim once the new binary is in place. These values are deliberately
    | read from server-side configuration rather than the API request. The
    | Panel upgrade route is restricted to active root administrators.
    |
    | The defaults match the generated systemd unit. OpenRC installations use
    | WINGS_RS_RESTART_COMMAND=rc-service and
    | WINGS_RS_RESTART_ARGS=wings,restart. A single Panel installation with
    | mixed init systems should not use this endpoint until restart settings
    | can be configured per node.
    */

    'wings_rs' => [
        'restart_command' => env('WINGS_RS_RESTART_COMMAND', 'systemctl'),
        'restart_command_args' => explode(',', env('WINGS_RS_RESTART_ARGS', 'restart,wings')),
    ],
];
