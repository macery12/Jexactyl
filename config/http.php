<?php

return [
    /*
    |--------------------------------------------------------------------------
    | API Rate Limits
    |--------------------------------------------------------------------------
    |
    | Defines the rate limit for the number of requests per minute that can be
    | executed against both the client and internal (application) APIs over the
    | defined period (by default, 1 minute).
    |
    */
    'rate_limit' => [
        'client_period' => 1,
        'client' => env('APP_API_CLIENT_RATELIMIT', 720),

        'application_period' => 1,
        'application' => env('APP_API_APPLICATION_RATELIMIT', 240),

        // Per-extension budget for extension-contributed admin API routes
        // (/api/application/extensions/ext/<id>/...). Counted per user per
        // extension, stacked inside the global application limit above.
        'ext_admin_period' => 1,
        'ext_admin' => env('APP_API_EXT_ADMIN_RATELIMIT', 60),

        // File diffing is CPU work in the Panel process, so it has a tighter
        // per-user budget in addition to the global client API limiter.
        'file_diff_period' => 1,
        'file_diff' => env('APP_API_FILE_DIFF_RATELIMIT', 10),
    ],
];
