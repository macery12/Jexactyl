<?php

namespace Everest\Tests\Unit\Services\Plugins;

use Everest\Tests\TestCase;
use Everest\Models\PluginProviderRule;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Plugins\PluginProviderGate;
use Everest\Services\Plugins\ProviderAccessService;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

class ProviderAccessServiceTest extends TestCase
{
    private ProviderAccessService $service;
    private bool $spigetEnabled = true;

    public function setUp(): void
    {
        parent::setUp();

        $this->app->instance(
            SettingsRepositoryInterface::class,
            \Mockery::mock(SettingsRepositoryInterface::class)->shouldReceive('get')->andReturnUsing(
                function (string $key, $default) {
                    if ($key === 'settings::modules:mods:spiget_enabled') {
                        return $this->spigetEnabled;
                    }

                    return $default;
                }
            )->getMock()
        );

        $this->service = new ProviderAccessService(new PluginProviderGate());

        if (!Schema::hasTable('plugin_provider_rules')) {
            Schema::create('plugin_provider_rules', function (Blueprint $table) {
                $table->id();
                $table->string('provider_key')->unique();
                $table->boolean('enabled_global')->default(false);
                $table->json('allowed_nest_ids')->nullable();
                $table->json('allowed_egg_ids')->nullable();
                $table->timestamps();
            });
        }
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('plugin_provider_rules');
        \Mockery::close();
        parent::tearDown();
    }

    public function testSpigotRuleOverridesLegacyAlias(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'spigot.plugins',
            'enabled_global' => false,
            'allowed_nest_ids' => [1],
            'allowed_egg_ids' => [],
        ]);

        PluginProviderRule::create([
            'provider_key' => 'spiget.plugins',
            'enabled_global' => true,
            'allowed_nest_ids' => [1],
            'allowed_egg_ids' => [],
        ]);

        $allowed = $this->service->getAllowedProvidersForServer(10, 1);

        $this->assertSame([], $allowed['plugins']);
    }

    public function testLegacySpigetRuleIsUsedWhenNoSpigotRule(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'spiget.plugins',
            'enabled_global' => true,
            'allowed_nest_ids' => [5],
            'allowed_egg_ids' => [],
        ]);

        $allowed = $this->service->getAllowedProvidersForServer(10, 5);

        $this->assertSame(['spigot'], $allowed['plugins']);
    }

    public function testSpigotHiddenWhenSpigetGloballyDisabled(): void
    {
        $this->spigetEnabled = false;

        PluginProviderRule::create([
            'provider_key' => 'spigot.plugins',
            'enabled_global' => true,
            'allowed_nest_ids' => [1],
            'allowed_egg_ids' => [],
        ]);

        $allowed = $this->service->getAllowedProvidersForServer(10, 1);

        $this->assertSame([], $allowed['plugins']);
    }
}
