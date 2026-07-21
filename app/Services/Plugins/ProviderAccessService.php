<?php

namespace Everest\Services\Plugins;

use Everest\Models\Setting;

class ProviderAccessService
{
    private const PROVIDERS_BY_TYPE = [
        'mods' => [
            ['key' => 'modrinth.mods', 'name' => 'modrinth'],
        ],
        'plugins' => [
            ['key' => 'modrinth.plugins', 'name' => 'modrinth'],
            ['key' => 'spigot.plugins', 'name' => 'spigot'],
        ],
    ];

    public function __construct(private PluginProviderGate $providerGate)
    {
    }

    public function isProviderAllowed(string $providerKey, int $nestId, int $eggId): bool
    {
        if ($providerKey === 'spigot.plugins') {
            $spigetEnabled = (bool) Setting::get(
                'settings::modules:mods:spiget_enabled',
                config('modules.mods.spiget_enabled', false)
            );

            if (!$spigetEnabled) {
                return false;
            }
        }

        return $this->providerGate->isProviderAllowed($providerKey, $nestId, $eggId);
    }

    public function getAllowedProvidersForServer(int $eggId, int $nestId): array
    {
        $allowed = [
            'mods' => [],
            'plugins' => [],
        ];

        foreach (self::PROVIDERS_BY_TYPE as $type => $providers) {
            foreach ($providers as $provider) {
                if ($this->isProviderAllowed($provider['key'], $nestId, $eggId)) {
                    $allowed[$type][] = $provider['name'];
                }
            }
        }

        foreach ($allowed as $type => $values) {
            $allowed[$type] = array_values(array_unique($values));
        }

        return $allowed;
    }
}
