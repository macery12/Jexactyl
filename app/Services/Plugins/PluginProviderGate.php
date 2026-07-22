<?php

namespace Everest\Services\Plugins;

use Everest\Models\PluginProviderRule;

class PluginProviderGate
{
    /**
     * Determine if a provider is allowed for the given nest and egg.
     * Default policy: deny when no rule exists or rule not enabled.
     */
    public function isProviderAllowed(string $providerKey, int $nestId, int $eggId): bool
    {
        /** @var PluginProviderRule|null $rule */
        $rule = PluginProviderRule::query()->where('provider_key', $providerKey)->first();
        if (!$rule && $providerKey === 'spigot.plugins') {
            $rule = PluginProviderRule::query()->where('provider_key', 'spiget.plugins')->first();
        }
        if (!$rule && $providerKey === 'modrinth.plugins') {
            $rule = PluginProviderRule::query()->where('provider_key', 'modrinth.mods')->first();
        }

        if (!$rule || !$rule->enabled_global) {
            return false;
        }

        $allowedEggs = $this->normalizeIds($rule->allowed_egg_ids);
        $allowedNests = $this->normalizeIds($rule->allowed_nest_ids);

        $hasEggOverrides = !empty($allowedEggs);

        // Egg overrides nest rules in both directions.
        if ($hasEggOverrides) {
            return in_array($eggId, $allowedEggs, true);
        }

        if (!empty($allowedNests)) {
            return in_array($nestId, $allowedNests, true);
        }

        // If globally enabled and no restrictions are set, allow all.
        return true;
    }

    /**
     * Remove duplicates and ensure integer values.
     *
     * @param array<int, mixed>|null $ids
     *
     * @return array<int, int>
     */
    private function normalizeIds(?array $ids): array
    {
        if (!$ids) {
            return [];
        }

        $ints = array_map(static function ($value) {
            return (int) $value;
        }, $ids);

        return array_values(array_unique($ints));
    }
}
