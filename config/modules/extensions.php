<?php

return [
    /*
     * Enable or disable the extensions module.
     * When enabled, admins can configure server extensions like player managers.
     */
    'enabled' => env('EXTENSIONS_ENABLED', true),

    /*
     * Available extensions configuration.
     * Each extension can be enabled/disabled independently.
        *
        * ---------------------------
        * Extension Settings (Admin UI)
        * ---------------------------
        * Extensions may define arbitrary admin-configurable settings using a `settings_schema`.
        *
        * - The admin panel renders the schema into a form automatically.
        * - Saved values are persisted in the database table `extension_configs.settings` (JSON), per extension id.
        * - These settings are GLOBAL for the extension (not per-server).
        * - The client extension endpoints can then read those saved values and apply them as defaults.
        *
        * Schema format (array of fields):
        *  - key: string (required)
        *  - label: string (required)
        *  - type: one of: text | password | textarea | select | boolean | number
        *  - help: string (optional)
        *  - placeholder: string (optional)
        *  - options: array<{ label: string, value: string|number|boolean }> (select only)
        *
        * Where the schema is used:
        *  - Admin API returns `settingsSchema` from this config file.
        *  - Admin UI reads that schema and shows a "Settings" section in the Configure modal.
        *  - When you click Save, it sends a `settings` object back to the API which is stored in `extension_configs.settings`.
        *
        * Reading settings later (backend / extensions):
        *  - Read from the DB via `ExtensionConfig`:
        *      $config = \Everest\Models\ExtensionConfig::getByExtensionId('your_extension_id');
        *      $settings = is_array($config?->settings) ? $config->settings : [];
        *      $value = $settings['your_key'] ?? null;
        *
        * Concrete examples:
        *
        * 1) URL string setting (text)
        *    Schema:
        *      'settings_schema' => [
        *          ['key' => 'jar_url', 'label' => 'Jar URL', 'type' => 'text'],
        *      ]
        *    Read + apply precedence (request override -> admin setting -> fallback):
        *      $jarUrl = $request->input('jar_url');
        *      if (!$jarUrl) $jarUrl = $settings['jar_url'] ?? null;
        *      if (!$jarUrl) $jarUrl = $fallbackUrl;
        *
        * 2) Feature toggle (boolean)
        *    Schema:
        *      'settings_schema' => [
        *          ['key' => 'enable_fast_mode', 'label' => 'Enable Fast Mode', 'type' => 'boolean'],
        *      ]
        *    Stored value is `true`/`false` JSON in the DB.
        *    Read (PHP):
        *      $fastMode = (bool) ($settings['enable_fast_mode'] ?? false);
        *
        *    If you ever integrate with systems that represent booleans as 1/0,
        *    treat them as truthy/falsey on read:
        *      $raw = $settings['enable_fast_mode'] ?? 0;
        *      $fastMode = (int) $raw === 1 || $raw === true;
        *
        * 3) Select / enum-like setting (select)
        *    Schema:
        *      'settings_schema' => [
        *          [
        *              'key' => 'log_level',
        *              'label' => 'Log Level',
        *              'type' => 'select',
        *              'options' => [
        *                  ['label' => 'Info', 'value' => 'info'],
        *                  ['label' => 'Debug', 'value' => 'debug'],
        *              ],
        *          ],
        *      ]
        *    Note: the browser will submit select values as strings; validate/cast if needed.
        *    Read (PHP):
        *      $level = (string) ($settings['log_level'] ?? 'info');
        *      if (!in_array($level, ['info', 'debug'], true)) $level = 'info';
        *
        * 4) Number setting (number)
        *    Schema:
        *      'settings_schema' => [
        *          ['key' => 'timeout_seconds', 'label' => 'Timeout (seconds)', 'type' => 'number'],
        *      ]
        *    Read (PHP):
        *      $timeout = (int) ($settings['timeout_seconds'] ?? 15);
        *
        * Notes:
        *  - These settings are not automatically validated server-side beyond "must be an array".
        *    If a setting is security-sensitive, validate it in your request/controller.
        *  - If you need PER-SERVER settings, do not use this store; create a server-scoped table or use a server metadata mechanism.
        *
     */
    'available' => [
        /*
         * Example extension (copy/paste template)
         *
         * 1) Pick a unique ID (array key). This becomes the extension_id everywhere.
         * 2) Create routes at: routes/extensions/client/<extension_id>.php
         *    and ensure the route prefix matches the `route` value below.
         * 3) Add frontend route entry in the extensions registry (server UI).
         * 4) Optional: define `settings_schema` to get schema-driven admin settings.
         *
         * NOTE: This block is commented out — it does nothing until you remove the comment.
         */

        // 'example_extension' => [
        //     'name' => 'Example Extension',
        //     'description' => 'An example extension showing how to wire settings + routes.',
        //     'version' => '0.1.0',
        //     'author' => 'YourName',
        //     // Icon key (shown in admin + server extension lists).
        //     // Available: puzzle|users|gamepad|cube|server|discord|link|wrench|shield|terminal|globe|database|chart|bell|robot|cloud|folder|file|key|bolt|cogs|lock|scroll
        //     'icon' => 'puzzle',
        //     'route' => 'example_extension',
        //
        //     // If you want a default enable flag from env:
        //     'enabled' => env('EXTENSION_EXAMPLE_EXTENSION_ENABLED', false),
        //
        //     // Eligibility (admin can override these in the UI)
        //     // Empty arrays mean "all nests/eggs".
        //     'allowed_nests' => [],
        //     'allowed_eggs' => [],
        //
        //     // Optional admin-configurable settings (saved to extension_configs.settings)
        //     'settings_schema' => [
        //         [
        //             'key' => 'api_base_url',
        //             'label' => 'API Base URL',
        //             'type' => 'text',
        //             'placeholder' => 'https://api.example.com',
        //             'help' => 'Used as the default base URL for outbound API calls.',
        //         ],
        //         [
        //             'key' => 'enabled_mode',
        //             'label' => 'Mode',
        //             'type' => 'select',
        //             'help' => 'Example select field. Stored in DB as a string.',
        //             'options' => [
        //                 ['label' => 'Safe', 'value' => 'safe'],
        //                 ['label' => 'Fast', 'value' => 'fast'],
        //             ],
        //         ],
        //         [
        //             'key' => 'feature_flag',
        //             'label' => 'Enable Feature',
        //             'type' => 'boolean',
        //             'help' => 'Example boolean toggle. Stored as true/false JSON.',
        //         ],
        //     ],
        // ],

    ],

    /*
     * Extension permissions prefix.
     * All extension permissions will be prefixed with this.
     */
    'permission_prefix' => 'extension',
];
