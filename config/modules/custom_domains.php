<?php

return [
    'enabled' => env('CUSTOM_DOMAINS_ENABLED', false),

    'cloudflare' => [
        'base_url' => env('CUSTOM_DOMAINS_CLOUDFLARE_BASE_URL', 'https://api.cloudflare.com/client/v4'),
        'retries' => (int) env('CUSTOM_DOMAINS_CLOUDFLARE_RETRIES', 3),
        'retry_sleep_ms' => (int) env('CUSTOM_DOMAINS_CLOUDFLARE_RETRY_SLEEP_MS', 250),
        'proxied' => (bool) env('CUSTOM_DOMAINS_CLOUDFLARE_PROXIED', false),
    ],

    'cleanup_on_delete' => (bool) env('CUSTOM_DOMAINS_CLEANUP_ON_DELETE', true),

    'security' => [
        'allow_wildcard' => (bool) env('CUSTOM_DOMAINS_ALLOW_WILDCARD', false),
        'max_wildcards_per_user' => (int) env('CUSTOM_DOMAINS_MAX_WILDCARDS_PER_USER', 1),
    ],

    'rate_limits' => [
        'create_per_minute' => (int) env('CUSTOM_DOMAINS_RATE_LIMIT_CREATE_PER_MINUTE', 10),
        'sync_per_minute' => (int) env('CUSTOM_DOMAINS_RATE_LIMIT_SYNC_PER_MINUTE', 5),
        'billing_options_per_minute' => (int) env('CUSTOM_DOMAINS_RATE_LIMIT_BILLING_OPTIONS_PER_MINUTE', 20),

        // Ceiling on outbound Cloudflare API calls from queued provisioning
        // work, applied through the `cloudflare` job rate limiter. Cloudflare
        // allows 1200 calls per five minutes per account and a single
        // ProvisionServerCustomDomainsJob can issue several per mapping, so
        // this keeps a bulk re-provision from spending the whole budget.
        'cloudflare_jobs_per_minute' => (int) env('CUSTOM_DOMAINS_CLOUDFLARE_JOBS_PER_MINUTE', 60),
    ],
];
