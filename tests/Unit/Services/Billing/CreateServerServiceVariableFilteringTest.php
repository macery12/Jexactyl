<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Services\Billing\CreateServerService;
use Everest\Services\Servers\ServerCreationService;
use Everest\Services\Servers\VariableValidatorService;

class CreateServerServiceVariableFilteringTest extends TestCase
{
    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testFilterUserEditableVariablesDropsHiddenInput(): void
    {
        $validator = \Mockery::mock(VariableValidatorService::class);
        $validator->shouldReceive('setUserLevel')->once()->with(User::USER_LEVEL_USER)->andReturnSelf();
        $validator->shouldReceive('handle')
            ->once()
            ->with(1, [
                'VISIBLE_KEY' => 'allowed-value',
                'HIDDEN_KEY' => 'attacker-value',
            ])
            ->andReturn(collect([
                (object) ['key' => 'VISIBLE_KEY', 'value' => 'allowed-value'],
            ]));

        $service = new CreateServerService(
            \Mockery::mock(ServerCreationService::class),
            $validator
        );

        $reflection = new \ReflectionMethod($service, 'filterUserEditableVariables');
        $reflection->setAccessible(true);

        $filtered = $reflection->invoke($service, 1, [
            ['key' => 'VISIBLE_KEY', 'value' => 'allowed-value'],
            ['key' => 'HIDDEN_KEY', 'value' => 'attacker-value'],
        ]);

        $this->assertSame([
            ['key' => 'VISIBLE_KEY', 'value' => 'allowed-value'],
        ], $filtered);
    }
}
