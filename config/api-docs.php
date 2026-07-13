<?php

return [
    /*
     * Gate whether runtime API documentation is available.
     * Enabled by default in non-production environments.
     */
    'enabled' => env('API_DOCS_ENABLED', true),

    /*
     * If true, requests must come from an authenticated admin user.
     */
    'admin_only' => env('API_DOCS_ADMIN_ONLY', true),

    /*
     * Include daemon / remote endpoints in the generated spec.
     */
    'include_remote_routes' => env('API_DOCS_INCLUDE_REMOTE', false),

    /*
     * URI prefixes (relative to the app root) that are never part of the
     * developer-facing API surface and should be hidden from the generated
     * spec. These are internal receivers and machine-to-machine endpoints
     * that a user never calls with an API token:
     *   - api/webhooks   payment-provider callbacks (Stripe/PayPal receivers)
     *   - api/storefront  unauthenticated landing-page catalog feed
     * Daemon routes (api/remote) are governed separately by
     * `include_remote_routes` above.
     */
    'exclude_prefixes' => [
        'api/webhooks',
        'api/storefront',
    ],

    'cache' => [
        'enabled' => env('API_DOCS_CACHE_ENABLED', true),
        'ttl' => env('API_DOCS_CACHE_TTL', 3600),
        'store' => env('API_DOCS_CACHE_STORE', 'file'),
    ],
];
