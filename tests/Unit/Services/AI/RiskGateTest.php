<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;

class RiskGateTest extends TestCase
{
    protected function tearDown(): void
    {
        Setting::forget('settings::modules:ai:risk_overrides');

        parent::tearDown();
    }

    public function testOverridesCannotRelaxDeclaredWriteOrDestructiveMinimums(): void
    {
        Setting::set('settings::modules:ai:risk_overrides', json_encode([
            'files_create_folder' => ToolDefinition::RISK_SAFE,
            'files_delete' => ToolDefinition::RISK_SAFE,
        ]));

        $gate = app(RiskGate::class);
        $registry = app(ToolRegistry::class);

        $this->assertSame(
            ToolDefinition::RISK_WRITE,
            $gate->resolve($registry->find('files_create_folder')),
        );
        $this->assertSame(
            ToolDefinition::RISK_DESTRUCTIVE,
            $gate->resolve($registry->find('files_delete')),
        );
    }

    public function testOverridesCanOnlyHardenDeclaredTiers(): void
    {
        Setting::set('settings::modules:ai:risk_overrides', json_encode([
            'files_read' => ToolDefinition::RISK_WRITE,
            'files_create_folder' => ToolDefinition::RISK_DESTRUCTIVE,
        ]));

        $gate = app(RiskGate::class);
        $registry = app(ToolRegistry::class);

        $this->assertSame(
            ToolDefinition::RISK_WRITE,
            $gate->resolve($registry->find('files_read')),
        );
        $this->assertSame(
            ToolDefinition::RISK_DESTRUCTIVE,
            $gate->resolve($registry->find('files_create_folder')),
        );
    }

    public function testKillRequiresTypedConfirmationWhileOtherPowerSignalsRemainWrites(): void
    {
        $gate = app(RiskGate::class);
        $definition = app(ToolRegistry::class)->find('server_power');

        foreach (['start', 'stop', 'restart'] as $signal) {
            $this->assertSame(
                ToolDefinition::RISK_WRITE,
                $gate->resolve($definition, ['signal' => $signal]),
                $signal,
            );
        }

        $this->assertSame(
            ToolDefinition::RISK_DESTRUCTIVE,
            $gate->resolve($definition, ['signal' => 'kill']),
        );
    }

    public function testRelaxingOverrideCannotMakeKillAutomatic(): void
    {
        Setting::set('settings::modules:ai:risk_overrides', json_encode([
            'server_power' => ToolDefinition::RISK_SAFE,
        ]));

        $gate = app(RiskGate::class);
        $definition = app(ToolRegistry::class)->find('server_power');

        $this->assertSame(
            ToolDefinition::RISK_DESTRUCTIVE,
            $gate->resolve($definition, ['signal' => 'kill']),
        );
        $this->assertFalse($gate->runsAutomatically(
            $gate->resolve($definition, ['signal' => 'kill']),
        ));
    }
}
