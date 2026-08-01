<?php

namespace Everest\Services\Billing;

use Everest\Models\Setting;

/**
 * Single source of truth for the customisable storefront (`/billing/order`).
 *
 * Mirrors the landing page system: the rich section structure is persisted as a
 * JSON blob under `modules:billing:store:config`, while the master enable toggle
 * lives under `modules:billing:store:enabled` (hydrated into config() by
 * SettingsServiceProvider). Both the admin editor and the view composer that
 * injects the config for the authenticated store page read through this service
 * so they never drift.
 */
class StoreConfigService
{
    public const CONFIG_KEY = 'settings::modules:billing:store:config';

    /** Section ids the store builder understands, in their default order. */
    public const SECTION_IDS = ['hero', 'features', 'catalog', 'custom', 'trust'];

    /**
     * Return the full store configuration: the master enable flag plus the
     * ordered list of sections. Falls back to built-in defaults when an operator
     * has never customised the page.
     */
    public function get(): array
    {
        return [
            'enabled' => $this->isEnabled(),
            'sections' => $this->sections(),
        ];
    }

    /**
     * Whether the store customisations are enabled. Defaults to true when no
     * value has ever been persisted (SettingsServiceProvider hydrates the key as
     * null in that case, so a plain config() default would not apply).
     */
    public function isEnabled(): bool
    {
        return (bool) (config('modules.billing.store.enabled') ?? true);
    }

    /**
     * The configured (or default) section list.
     */
    public function sections(): array
    {
        $raw = Setting::get(self::CONFIG_KEY);

        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);

            if (is_array($decoded) && isset($decoded['sections']) && is_array($decoded['sections'])) {
                return array_values($decoded['sections']);
            }
        }

        return $this->defaultSections();
    }

    /**
     * The default section structure. All copy fields are intentionally left blank
     * so the frontend falls back to the translated Paraglide defaults (the
     * existing `billing.store.*` messages). The catalog section is always present
     * and enabled — it is the storefront's reason to exist.
     */
    public function defaultSections(): array
    {
        return [
            ['id' => 'hero', 'enabled' => true, 'order' => 0, 'data' => [
                'badge' => '', 'title' => '', 'subtitle' => '', 'backgroundImage' => '',
                'primaryCta' => ['label' => '', 'href' => '#plans'],
                'promoText' => '',
            ]],
            ['id' => 'features', 'enabled' => false, 'order' => 1, 'data' => [
                'heading' => '',
                'items' => [
                    ['icon' => 'Zap', 'title' => '', 'body' => ''],
                    ['icon' => 'ShieldCheck', 'title' => '', 'body' => ''],
                    ['icon' => 'HardDrive', 'title' => '', 'body' => ''],
                ],
            ]],
            ['id' => 'catalog', 'enabled' => true, 'order' => 2, 'data' => [
                'heading' => '', 'subheading' => '',
                // Spotlight ("most popular") plan. featuredProductId null = auto
                // (the first plan of the selected category, the original behaviour).
                'featuredEnabled' => true, 'featuredBadge' => '', 'featuredCta' => '',
                'featuredProductId' => null,
            ]],
            ['id' => 'custom', 'enabled' => false, 'order' => 3, 'data' => [
                'title' => '', 'body' => '',
            ]],
            ['id' => 'trust', 'enabled' => true, 'order' => 4, 'data' => [
                'items' => [], 'methods' => [], 'acceptedLabel' => '',
            ]],
        ];
    }
}
