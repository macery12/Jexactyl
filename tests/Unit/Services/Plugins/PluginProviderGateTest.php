<?php

namespace Everest\Tests\Unit\Services\Plugins;

use Everest\Models\PluginProviderRule;
use Everest\Services\Plugins\PluginProviderGate;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

class PluginProviderGateTest extends TestCase
{
    private PluginProviderGate $gate;

    public function setUp(): void
    {
        parent::setUp();

        $this->gate = new PluginProviderGate();

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
        parent::tearDown();
    }

    public function testDefaultDenyWhenNoRule(): void
    {
        $this->assertFalse($this->gate->isProviderAllowed('modrinth.mods', 1, 10));
    }

    public function testNestAllowGrantsAccess(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'modrinth.mods',
            'enabled_global' => true,
            'allowed_nest_ids' => [5],
            'allowed_egg_ids' => [],
        ]);

        $this->assertTrue($this->gate->isProviderAllowed('modrinth.mods', 5, 99));
        $this->assertFalse($this->gate->isProviderAllowed('modrinth.mods', 6, 99));
    }

    public function testEggOverrideDeny(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'modrinth.mods',
            'enabled_global' => true,
            'allowed_nest_ids' => [2],
            'allowed_egg_ids' => [201],
        ]);

        // Egg not listed should be denied even though nest is allowed.
        $this->assertFalse($this->gate->isProviderAllowed('modrinth.mods', 2, 202));
    }

    public function testEggOverrideAllow(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'spigot.plugins',
            'enabled_global' => true,
            'allowed_nest_ids' => [],
            'allowed_egg_ids' => [42],
        ]);

        $this->assertTrue($this->gate->isProviderAllowed('spigot.plugins', 9, 42));
        $this->assertFalse($this->gate->isProviderAllowed('spigot.plugins', 9, 43));
    }

    public function testGloballyEnabledWithoutRestrictionsAllowsAll(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'spigot.plugins',
            'enabled_global' => true,
            'allowed_nest_ids' => [],
            'allowed_egg_ids' => [],
        ]);

        $this->assertTrue($this->gate->isProviderAllowed('spigot.plugins', 1, 1));
        $this->assertTrue($this->gate->isProviderAllowed('spigot.plugins', 99, 999));
    }

    public function testModrinthPluginsFallbackToModsRule(): void
    {
        PluginProviderRule::create([
            'provider_key' => 'modrinth.mods',
            'enabled_global' => true,
            'allowed_nest_ids' => [],
            'allowed_egg_ids' => [],
        ]);

        $this->assertTrue($this->gate->isProviderAllowed('modrinth.plugins', 3, 15));
    }
}
