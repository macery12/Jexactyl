<?php

namespace Everest\Providers;

use Illuminate\Support\Arr;
use Psr\Log\LoggerInterface as Log;
use Illuminate\Database\QueryException;
use Illuminate\Support\ServiceProvider;
use Everest\Services\Security\SecretEncryptionService;
use Everest\Contracts\Repository\SettingsRepositoryInterface;
use Illuminate\Contracts\Config\Repository as ConfigRepository;

class SettingsServiceProvider extends ServiceProvider
{
    protected array $keys = [
        // M12Labs-specific keys
        'app:name', 'app:logo', 'app:mode', 'app:setup', 'app:locale',
        'app:user_locale', 'app:command_palette', 'app:quick_tabs',
        'pterodactyl:guzzle:timeout', 'pterodactyl:guzzle:connect_timeout',
        'pterodactyl:console:count', 'pterodactyl:console:frequency',
        'pterodactyl:auth:2fa_required',
        'pterodactyl:client_features:allocations:enabled',
        'pterodactyl:client_features:allocations:range_start',
        'pterodactyl:client_features:allocations:range_end',
        'activity:enabled:account',
        'activity:enabled:server',
        'activity:enabled:admin',

        // Authentication module settings
        'modules:auth:registration:enabled',
        'modules:auth:security:force2fa',
        'modules:auth:security:attempts',

        'modules:auth:discord:enabled',
        'modules:auth:discord:client_id',
        'modules:auth:discord:client_secret',

        'modules:auth:google:enabled',
        'modules:auth:google:client_id',
        'modules:auth:google:client_secret',

        'modules:auth:onboarding:enabled',
        'modules:auth:onboarding:content',

        'modules:auth:jguard:enabled',
        'modules:auth:jguard:approval_mode',
        'modules:auth:jguard:delay',
        'modules:auth:jguard:pending_message',

        // Billing module settings
        'modules:billing:enabled',
        'modules:billing:processor',
        'modules:billing:paypal',
        'modules:billing:link',
        'modules:billing:keys:publishable',
        'modules:billing:keys:secret',
        'modules:billing:currency:code',
        'modules:billing:currency:symbol',
        'modules:billing:links:terms',
        'modules:billing:links:privacy',
        'modules:billing:renewal:suspension_threshold',
        'modules:billing:plan_change_cooldown_hours',
        'modules:billing:integrations:stripe:enabled',
        'modules:billing:integrations:paypal:enabled',
        'modules:billing:paypal_standalone:client_id',
        'modules:billing:paypal_standalone:client_secret',
        'modules:billing:paypal_standalone:mode',
        // Storefront customisation master toggle. The rich section structure is
        // stored as a JSON blob under `modules:billing:store:config` and read
        // directly via Setting::get — only this scalar toggle is hydrated here.
        'modules:billing:store:enabled',

        // Ticket module settings
        'modules:tickets:enabled',
        'modules:tickets:max_count',

        // Alert module settings
        'modules:alert:enabled',
        'modules:alert:type',
        'modules:alert:position',
        'modules:alert:content',
        'modules:alert:uuid',

        // AI module settings
        'modules:ai:enabled',
        'modules:ai:key',
        'modules:ai:endpoint',
        'modules:ai:model',
        'modules:ai:provider',
        // Deprecated in favour of `provider`; still hydrated so installs that
        // predate the multi-provider rework keep resolving a driver.
        'modules:ai:mode',
        'modules:ai:models:agent',
        'modules:ai:models:fast',
        'modules:ai:max_tokens',
        'modules:ai:temperature',
        'modules:ai:context_tokens',
        'modules:ai:system_prompt',
        'modules:ai:feature_server_assistant',
        'modules:ai:feature_crash_analysis',
        'modules:ai:keep_alive',
        'modules:ai:warm',
        'modules:ai:agent:enabled',
        'modules:ai:agent:admin_enabled',
        'modules:ai:agent:reasoning',
        'modules:ai:agent:max_steps',
        'modules:ai:agent:max_wall_seconds',
        'modules:ai:agent:durable',
        'modules:ai:agent:max_tool_seconds',
        'modules:ai:agent:tool_result_bytes',
        'modules:ai:agent:max_repairs',
        'modules:ai:agent:max_tools',
        'modules:ai:agent:max_batch_calls',
        'modules:ai:agent:allow_destructive_batches',
        'modules:ai:concurrency:slots',
        'modules:ai:concurrency:queue_depth',
        'modules:ai:concurrency:max_wait_seconds',
        'modules:ai:concurrency:per_user',
        'modules:ai:budget:enforce',
        'modules:ai:budget:monthly_tokens',
        'modules:ai:privacy:enabled',
        // NB: the tool policy is stored as JSON blobs under
        // `modules:ai:risk_overrides`, `modules:ai:disabled_tools` and
        // `modules:ai:console:safe_commands`, and read directly via
        // Setting::get rather than being hydrated into config.
        // `modules:ai:privacy:categories` is a JSON list read the same way.

        // Webhook module settings
        'modules:webhooks:enabled',
        'modules:webhooks:url',

        // Mods module settings
        'modules:mods:enabled',
        'modules:mods:allow_external_downloads',
        'modules:mods:curseforge_enabled',
        'modules:mods:curseforge_api_key',
        'modules:mods:curseforge_cdn_fallback',

        // Extensions module settings
        'modules:extensions:enabled',

        // Email module master toggle. Distinct from mail-delivery capability
        // (EmailManager::isDeliveryEnabled) — this only governs whether the
        // Email admin module is surfaced in the panel.
        'modules:email:enabled',

        // Landing page module settings
        // NB: the rich section structure is stored as a JSON blob under
        // `modules:landing:config` and read directly via Setting::get — only the
        // scalar master toggle is hydrated into config() here.
        'modules:landing:enabled',

        // Custom domains module settings
        'modules:custom_domains:enabled',
        'modules:custom_domains:cloudflare:token',
        'modules:custom_domains:security:allow_wildcard',
        'modules:custom_domains:security:max_wildcards_per_user',
        'modules:custom_domains:rate_limits:create_per_minute',
        'modules:custom_domains:rate_limits:sync_per_minute',
        'modules:custom_domains:rate_limits:billing_options_per_minute',
    ];

    /**
     * Map of string → typed values.
     */
    protected array $map = [
        'true' => true,   '(true)' => true,
        'false' => false,  '(false)' => false,
        'empty' => '',     '(empty)' => '',
        '1' => 1,      '0' => 0,
        'null' => null,   '(null)' => null,
    ];

    public function boot(
        ConfigRepository $config,
        Log $log,
        SettingsRepositoryInterface $settings,
    ): void {
        $secrets = app(SecretEncryptionService::class);

        try {
            $values = $settings->all()
                ->mapWithKeys(fn ($setting) => [$setting->key => $setting->value])
                ->toArray();
        } catch (QueryException $exception) {
            $log->notice(
                'A query exception was encountered while trying to load settings from the database: ' .
                $exception->getMessage()
            );

            return;
        }

        foreach ($this->keys as $key) {
            $dotKey = str_replace(':', '.', $key);

            $value = Arr::get($values, 'settings::' . $key, $config->get($dotKey));

            if ($secrets->isSecretKey('settings::' . $key)) {
                // Never decrypt secrets during boot; only surface whether a value exists.
                $config->set($dotKey, !empty($value));
                continue;
            }

            $lower = is_string($value) ? strtolower($value) : $value;

            if (is_string($lower) && array_key_exists($lower, $this->map)) {
                $value = $this->map[$lower];
            }

            $config->set($dotKey, $value);
        }
    }
}
