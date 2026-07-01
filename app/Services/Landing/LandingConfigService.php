<?php

namespace Everest\Services\Landing;

use Everest\Models\Setting;

/**
 * Single source of truth for the public landing page configuration.
 *
 * The rich section structure is persisted as a JSON blob under the
 * `modules:landing:config` setting; the master enable toggle lives under
 * `modules:landing:enabled` (hydrated into config() by SettingsServiceProvider).
 * Both the admin editor, the view composer that injects the config for guests,
 * and the public storefront gate read through this service so they never drift.
 */
class LandingConfigService
{
    public const CONFIG_KEY = 'settings::modules:landing:config';

    /** Section ids the builder understands, in their default order. */
    public const SECTION_IDS = ['hero', 'features', 'pricing', 'faq', 'testimonials', 'custom'];

    /**
     * Return the full landing configuration: the master enable flag plus the
     * ordered list of sections. Falls back to sensible built-in defaults when an
     * operator has never customised the page.
     */
    public function get(): array
    {
        return [
            'enabled' => $this->isEnabled(),
            'sections' => $this->sections(),
        ];
    }

    /**
     * Whether the landing page customisations are enabled. Defaults to true when
     * no value has ever been persisted (SettingsServiceProvider hydrates the key
     * as null in that case, so a plain config() default would not apply).
     */
    public function isEnabled(): bool
    {
        return (bool) (config('modules.landing.enabled') ?? true);
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
     * Whether the pricing/product-showcase section is enabled. Used to gate the
     * public storefront catalog endpoint — we never expose the catalog unless an
     * operator has explicitly opted in.
     */
    public function isPricingEnabled(): bool
    {
        if (!$this->isEnabled()) {
            return false;
        }

        foreach ($this->sections() as $section) {
            if (($section['id'] ?? null) === 'pricing') {
                return (bool) ($section['enabled'] ?? false);
            }
        }

        return false;
    }

    /**
     * The default section structure. All copy fields are intentionally left blank
     * so the frontend falls back to the translated Paraglide defaults.
     */
    public function defaultSections(): array
    {
        return [
            ['id' => 'hero', 'enabled' => true, 'order' => 0, 'data' => [
                'badge' => '', 'title' => '', 'subtitle' => '', 'backgroundImage' => '',
                'primaryCta' => ['label' => '', 'href' => '/v2/auth/login'],
                'secondaryCta' => ['label' => '', 'href' => ''],
            ]],
            ['id' => 'features', 'enabled' => true, 'order' => 1, 'data' => [
                'items' => [
                    ['icon' => 'Gauge', 'title' => '', 'body' => ''],
                    ['icon' => 'ShieldCheck', 'title' => '', 'body' => ''],
                    ['icon' => 'Boxes', 'title' => '', 'body' => ''],
                ],
            ]],
            ['id' => 'pricing', 'enabled' => false, 'order' => 2, 'data' => [
                'heading' => '', 'categoryIds' => [],
            ]],
            ['id' => 'faq', 'enabled' => false, 'order' => 3, 'data' => ['items' => []]],
            ['id' => 'testimonials', 'enabled' => false, 'order' => 4, 'data' => ['items' => []]],
            ['id' => 'custom', 'enabled' => false, 'order' => 5, 'data' => ['title' => '', 'body' => '']],
        ];
    }
}
