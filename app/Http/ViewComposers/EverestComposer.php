<?php

namespace Everest\Http\ViewComposers;

use Illuminate\View\View;
use Everest\Models\Setting;
use Everest\Models\ExtensionConfig;
use Everest\Services\Email\EmailManager;
use Everest\Services\Billing\StoreConfigService;
use Everest\Services\Email\EmailVerificationGate;
use Everest\Services\Billing\InvoiceSettingsService;
use Everest\Services\Billing\PaymentWebhookRegistry;
use Everest\Services\Billing\PaymentProcessorConfigService;

class EverestComposer
{
    public function __construct(
        private PaymentProcessorConfigService $processorConfigService,
        private EmailVerificationGate $emailVerificationGate,
        private InvoiceSettingsService $invoiceSettingsService,
        private StoreConfigService $storeConfigService,
        private PaymentWebhookRegistry $paymentWebhookRegistry,
    ) {
    }

    /**
     * Provide access to the asset service in the views.
     */
    public function compose(View $view): void
    {
        $processorConfig = $this->processorConfigService->getProcessorConfig();

        // Build public configuration (slim, essential fields only)
        $configuration = [
            'auth' => [
                'registration' => [
                    'enabled' => boolval(config('modules.auth.registration.enabled', false)),
                ],
                'security' => [
                    'force2fa' => boolval(config('modules.auth.security.force2fa', false)),
                ],
                'captcha' => [
                    'provider' => Setting::get('settings::modules:auth:captcha:provider', 'disabled'),
                    'site_key' => Setting::get('settings::modules:auth:captcha:site_key', ''),
                ],
                'modules' => [
                    'discord' => [
                        'enabled' => boolval(config('modules.auth.discord.enabled', false)),
                        'clientId' => !empty(config('modules.auth.discord.client_id')),
                        'clientSecret' => !empty(config('modules.auth.discord.client_secret')),
                    ],
                    'google' => [
                        'enabled' => boolval(config('modules.auth.google.enabled', false)),
                        'clientId' => !empty(config('modules.auth.google.client_id', false)),
                        'clientSecret' => !empty(config('modules.auth.google.client_secret')),
                    ],
                    'onboarding' => [
                        'enabled' => boolval(config('modules.auth.onboarding.enabled', false)),
                        'content' => config('modules.auth.onboarding.content', ''),
                    ],
                    'jguard' => [
                        'enabled' => boolval(config('modules.auth.jguard.enabled', false)),
                        'approval_mode' => config('modules.auth.jguard.approval_mode', 'manual'),
                        'delay' => (int) config('modules.auth.jguard.delay', 60),
                        'pending_message' => Setting::get('settings::modules:auth:jguard:pending_message', config('modules.auth.jguard.pending_message', '')),
                    ],
                ],
            ],
            'tickets' => [
                'enabled' => boolval(config('modules.tickets.enabled', false)),
                'maxCount' => config('modules.tickets.max_count', 3),
            ],
            'billing' => [
                'enabled' => boolval(config('modules.billing.enabled', false)),
                'processors' => $processorConfig,
                'currency' => [
                    'symbol' => config('modules.billing.currency.symbol'),
                    'code' => config('modules.billing.currency.code'),
                ],
                'links' => [
                    'terms' => config('modules.billing.links.terms'),
                    'privacy' => config('modules.billing.links.privacy'),
                ],
                // Operator-customisable storefront (hero/banner, features,
                // catalog, custom block, trust bar). Blank copy fields fall back
                // to the translated Paraglide defaults on the frontend.
                'store' => $this->storeConfigService->get(),
                'integrations' => [
                    'stripe' => [
                        'enabled' => boolval(config('modules.billing.integrations.stripe.enabled', false)),
                    ],
                    'paypal' => [
                        'enabled' => boolval(config('modules.billing.integrations.paypal.enabled', false)),
                    ],
                ],
            ],
            'email' => [
                'enabled' => $this->emailEnabled(),
                // Master toggle for surfacing the Email admin module in the panel
                // (independent of whether mail delivery is actually configured).
                'module_enabled' => boolval(config('modules.email.enabled', false)),
                'resend' => [
                    'enabled' => $this->emailEnabled(),
                ],
                'verification_rules' => $this->emailVerificationGate->getRules(),
            ],
            'ai' => [
                'enabled' => boolval(config('modules.ai.enabled', false)),
                'feature_server_assistant' => boolval(config('modules.ai.feature_server_assistant', true)),
                // The agent is gated separately from the assistant: it can act
                // on a server, so turning chat on must not turn it on too.
                'feature_agent' => boolval(config('modules.ai.agent.enabled', false)),
                // And the admin assistant separately again, because it acts on
                // the panel itself rather than on one customer's server.
                'feature_admin_agent' => boolval(config('modules.ai.agent.enabled', false))
                    && boolval(config('modules.ai.agent.admin_enabled', false)),
            ],
            'webhooks' => [
                'enabled' => boolval(config('modules.webhooks.enabled', false)),
                'url' => !empty(config('modules.webhooks.url')),
            ],
            'mods' => [
                // Read the bridged config value (SettingsServiceProvider maps the
                // stored string onto a real bool). Reading the raw setting here
                // would hit PHP's boolval('false') === true trap and leave the
                // module looking enabled after it was toggled off.
                'enabled' => boolval(config('modules.mods.enabled', false)),
                'default_source' => Setting::get('settings::modules:mods:default_source', config('modules.mods.default_source', 'modrinth')),
                'allow_external_downloads' => (bool) Setting::get('settings::modules:mods:allow_external_downloads', config('modules.mods.allow_external_downloads', false)),
                'curseforge_cdn_fallback'  => (bool) Setting::get('settings::modules:mods:curseforge_cdn_fallback', config('modules.mods.curseforge_cdn_fallback', true)),
                // CurseForge powers modpacks only. Expose whether the integration is usable
                // (enabled by an admin AND an API key is configured) — never the key itself.
                'curseforge' => [
                    'enabled' => (bool) Setting::get('settings::modules:mods:curseforge_enabled', config('modules.mods.curseforge_enabled', false)),
                    'configured' => !empty(Setting::get('settings::modules:mods:curseforge_api_key', '')),
                ],
                'download' => [
                    'max_concurrent_per_server' => (int) Setting::get('settings::modules:mods:download_max_concurrent', config('modules.mods.download.max_concurrent_per_server', 3)),
                    'max_per_minute_per_user'   => (int) Setting::get('settings::modules:mods:download_max_per_minute', config('modules.mods.download.max_per_minute_per_user', 10)),
                    'max_queue_size_per_server' => (int) Setting::get('settings::modules:mods:download_max_queue_size', config('modules.mods.download.max_queue_size_per_server', 20)),
                    'max_mod_size_mb'           => (int) round(Setting::get('settings::modules:mods:max_mod_size', config('modules.mods.max_mod_size', 157286400)) / 1048576),
                    'max_plugin_size_mb'        => (int) round(Setting::get('settings::modules:mods:max_plugin_size', config('modules.mods.max_plugin_size', 104857600)) / 1048576),
                ],
            ],
            'extensions' => [
                'enabled' => boolval(config('modules.extensions.enabled', false)),
            ],
            'custom_domains' => [
                'enabled' => boolval(config('modules.custom_domains.enabled', false)),
            ],
        ];

        // Merge admin-only configuration if user is authenticated admin
        $user = auth()->user();
        if ($user && $user->isAdministrator()) {
            $configuration = array_merge_recursive($configuration, $this->getAdminConfiguration());
        }

        $view->with('everestConfiguration', $configuration);
    }

    /**
     * Get admin-only configuration with sensitive/admin-specific fields.
     * This is only exposed to admin users.
     */
    private function getAdminConfiguration(): array
    {
        $invoiceSettings = $this->invoiceSettingsService->get();

        return [
            'billing' => [
                'webhook_setup' => $this->paymentWebhookRegistry->adminConfiguration(),
                'keys' => [
                    'publishable' => boolval(config('modules.billing.keys.publishable')),
                    'secret' => boolval(config('modules.billing.keys.secret')),
                ],
                'paypal_standalone' => [
                    'mode' => config('modules.billing.paypal_standalone.mode', 'sandbox'),
                    'credentials_configured' => !empty(Setting::get(
                        'settings::modules:billing:paypal_standalone:client_id',
                        config('modules.billing.paypal_standalone.client_id', '')
                    )) && !empty(Setting::get(
                        'settings::modules:billing:paypal_standalone:client_secret',
                        config('modules.billing.paypal_standalone.client_secret', '')
                    )),
                ],
                'renewal' => [
                    'days' => config('modules.billing.renewal.days', 30),
                    'free_renewal_days' => config('modules.billing.renewal.free_renewal_days', 30),
                    'suspension_threshold' => config('modules.billing.renewal.suspension_threshold', 7),
                    'suspension_threshold_percentage' => config('modules.billing.renewal.suspension_threshold_percentage', 0.20),
                    'min_suspension_threshold_days' => config('modules.billing.renewal.min_suspension_threshold_days', 3),
                    'max_suspension_threshold_days' => config('modules.billing.renewal.max_suspension_threshold_days', 7),
                    'free_suspension_days' => config('modules.billing.renewal.free_suspension_days', 7),
                    'paid_suspension_days' => config('modules.billing.renewal.paid_suspension_days', 30),
                    'default_billing_days' => (int) Setting::get('settings::modules:billing:renewal:default_billing_days', config('modules.billing.renewal.default_billing_days', 30)),
                    'multiplier_steps' => Setting::get('settings::modules:billing:renewal:multiplier_steps', config('modules.billing.renewal.multiplier_steps')),
                ],
                'plan_change_cooldown_hours' => config('modules.billing.plan_change_cooldown_hours', 72),
                'require_billing_address' => (bool) $invoiceSettings->require_billing_address,
            ],
            // Enabled extension ids gate extension-contributed admin nav/routes;
            // non-admins never receive the list. The extensions.admin middleware
            // enforces the same state server-side regardless.
            'extensions' => [
                'active' => $this->enabledExtensionIds(),
            ],
        ];
    }

    /**
     * @return array<int, string>
     */
    private function enabledExtensionIds(): array
    {
        try {
            return ExtensionConfig::query()->where('enabled', true)->pluck('extension_id')->all();
        } catch (\Throwable) {
            // Fresh installs may render views before migrations exist.
            return [];
        }
    }

    private function emailEnabled(): bool
    {
        return EmailManager::isDeliveryEnabled();
    }
}
