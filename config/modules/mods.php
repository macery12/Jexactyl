<?php

return [
    /*
     * Enable or disable the mods module.
     */
    'enabled' => env('MODS_ENABLED', false),

    /*
     * Default mod source (modrinth, spigot, or spiget).
     */
    'default_source' => env('MODS_DEFAULT_SOURCE', 'modrinth'),

    /*
     * Cache settings for API responses
     */
    'cache' => [
        'enabled' => env('MODS_CACHE_ENABLED', true),
        'ttl' => [
            'search' => env('MODS_CACHE_SEARCH_TTL', 900), // 15 minutes
            'mod_details' => env('MODS_CACHE_MOD_DETAILS_TTL', 1800), // 30 minutes
            'mod_files' => env('MODS_CACHE_MOD_FILES_TTL', 600), // 10 minutes
            'versions' => env('MODS_CACHE_VERSIONS_TTL', 3600), // 1 hour
            'loaders' => env('MODS_CACHE_LOADERS_TTL', 3600), // 1 hour
        ],
    ],

    /*
     * Modrinth API endpoint
     */
    'modrinth_api_url' => env('MODRINTH_API_URL', 'https://api.modrinth.com/v2'),

    /*
     * CurseForge API endpoint and toggle. CurseForge powers modpacks only.
     * The API key is stored encrypted in settings (settings::modules:mods:curseforge_api_key)
     * and is read at runtime via Setting::get — it is NOT sourced from this config.
     */
    'curseforge_api_url' => env('CURSEFORGE_API_URL', 'https://api.curseforge.com/v1'),
    'curseforge_enabled' => env('CURSEFORGE_ENABLED', false),
    // When enabled, files with no API-provided download URL fall back to the public CurseForge CDN.
    // API-provided URLs are always preferred; this only activates for distribution-disabled mods.
    'curseforge_cdn_fallback' => env('CURSEFORGE_CDN_FALLBACK', true),

    /*
     * CurseForge API rate limiting (per Cache, not persisted).
     */
    'rate_limit' => [
        'requests_per_minute' => env('CURSEFORGE_RATE_LIMIT_PER_MINUTE', 30),
        'requests_per_hour'   => env('CURSEFORGE_RATE_LIMIT_PER_HOUR', 1800),
    ],

    /*
     * Spigot (Spiget API) endpoint and toggle.
     */
    'spiget_api_url' => env('SPIGET_API_URL', 'https://api.spiget.org/v2'),
    'spiget_enabled' => env('SPIGET_ENABLED', true),
    'allow_external_downloads' => env('MODS_ALLOW_EXTERNAL_DOWNLOADS', false),

    /*
     * Maximum download sizes (in bytes).
     */
    'max_mod_size' => env('MODS_MAX_MOD_SIZE', 157286400), // 150MB default
    'max_plugin_size' => env('PLUGINS_MAX_SIZE', 104857600), // 100MB default

    /*
     * Default page size for mod listings
     */
    'default_page_size' => env('MODS_DEFAULT_PAGE_SIZE', 20),

    /*
     * Maximum page size for mod listings
     */
    'max_page_size' => env('MODS_MAX_PAGE_SIZE', 50),

    /*
     * Modpack installer. The panel resolves every mod's download URL, then the
     * Wings daemon (POST /api/servers/{uuid}/script) downloads the pack and its
     * mods directly into the server data dir — no panel-side file transfer.
     *
     * The install is split into many short script calls (one for overrides, then
     * mod batches) so each panel->Wings request returns well under any proxy
     * timeout — notably Cloudflare's ~100s cap, which otherwise 524s long installs.
     */
    'installer' => [
        'container_image' => env('MODS_INSTALLER_IMAGE', 'ghcr.io/pterodactyl/installers:debian'),
        // Mods downloaded per script call (upper bound; a call may do fewer if it
        // hits the per-call deadline first).
        'mods_per_batch'  => env('MODS_INSTALLER_BATCH', 100),
        // Wall-clock budget (seconds) a single mods batch script runs before it
        // stops starting new downloads and returns. Keep well below call_timeout.
        'batch_deadline'  => env('MODS_INSTALLER_BATCH_DEADLINE', 60),
        // Per-request (Guzzle) timeout for one script call. MUST stay below the
        // node's proxy timeout (Cloudflare = ~100s) to avoid a 524.
        'call_timeout'    => env('MODS_INSTALLER_CALL_TIMEOUT', 90),
        // Hard ceiling (seconds) for the whole orchestrating job (all batches).
        // The job runs in the worker, not behind the proxy, so this can be large.
        'install_timeout' => env('MODS_INSTALLER_INSTALL_TIMEOUT', 3600),
        // Job attempts for the normal install path. With resume + skip-existing a
        // transient batch failure picks up where it left off.
        'tries'           => env('MODS_INSTALLER_TRIES', 3),

        /*
         * Loader install. When a modpack needs a mod loader the server doesn't have,
         * we install it via the /script endpoint instead of swapping eggs. The
         * installer runs `java -jar ... --installServer`, so it needs a Java image,
         * and we set the server's startup command to a universal one that launches
         * any loader (detects unix_args.txt vs .serverjar).
         */
        // Yolks Java images keyed by minimum Minecraft version (descending). The
        // first entry whose key is <= the pack's MC version wins; '*' is the fallback.
        // This is the image the SERVER RUNS on (set on server.image).
        'java_images' => [
            '1.20.5' => 'ghcr.io/pterodactyl/yolks:java_21',
            '1.18'   => 'ghcr.io/pterodactyl/yolks:java_17',
            '1.17'   => 'ghcr.io/pterodactyl/yolks:java_16',
            '*'      => 'ghcr.io/pterodactyl/yolks:java_8',
        ],
        'default_java_image' => env('MODS_INSTALLER_JAVA_IMAGE', 'ghcr.io/pterodactyl/yolks:java_21'),
        // Image used to RUN the loader installer via /script. Must run as root so it
        // can write /mnt/server (the yolks images drop to a non-root user and can't),
        // and carry java. eclipse-temurin is root + has apt for a curl fallback.
        'loader_java_images' => [
            '1.20.5' => 'eclipse-temurin:21-jdk',
            '1.18'   => 'eclipse-temurin:17-jdk',
            '1.17'   => 'eclipse-temurin:17-jdk',
            '*'      => 'eclipse-temurin:8-jdk',
        ],
        'default_loader_image' => env('MODS_INSTALLER_LOADER_IMAGE', 'eclipse-temurin:21-jdk'),
        // Universal startup command (from the curseforge-generic egg): uses
        // @unix_args.txt when present (Forge/NeoForge 1.17+), else `-jar $(cat .serverjar)`
        // (Fabric/Quilt/old Forge). {{SERVER_MEMORY}} is substituted by Wings at boot.
        'universal_startup' => 'java $([[ -f user_jvm_args.txt ]] && printf %s "@user_jvm_args.txt") -Xms128M -Xmx{{SERVER_MEMORY}}M -Dterminal.jline=false -Dterminal.ansi=true $([[ ! -f unix_args.txt ]] && printf %s "-jar `cat .serverjar`" || printf %s "@unix_args.txt")',
        // Per-request timeout (seconds) for the loader install script call (java
        // installer download + run). Larger than a mod batch but still proxy-safe-ish;
        // loader installs are a single call and usually finish in 20–60s.
        'loader_timeout' => env('MODS_INSTALLER_LOADER_TIMEOUT', 90),
    ],

    /*
     * Download queue limits (configurable in admin panel).
     */
    'download' => [
        'max_concurrent_per_server' => env('MODS_DOWNLOAD_MAX_CONCURRENT', 3),
        'max_per_minute_per_user'   => env('MODS_DOWNLOAD_MAX_PER_MINUTE', 10),
        'max_queue_size_per_server' => env('MODS_DOWNLOAD_MAX_QUEUE_SIZE', 20),
    ],
];
