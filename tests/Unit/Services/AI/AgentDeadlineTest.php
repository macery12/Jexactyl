<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Everest\Models\User;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Tools\ToolExecutor;

class AgentDeadlineTest extends TestCase
{
    public function testInitialAndResumedOperationsShareOneFakeClockDeadline(): void
    {
        config()->set('modules.ai.agent.max_wall_seconds', 30);

        $runner = new class () extends AgentRunner {
            public float $clock = 100.0;

            public function __construct()
            {
            }

            protected function now(): float
            {
                return $this->clock;
            }
        };

        $context = new AgentContext(User::factory()->make(), null, 'turn-deadline');
        $this->assertSame(130.0, $runner->beginDeadline($context));

        // Approval/batch work consumes five seconds. Beginning the following
        // model loop must retain 130 rather than minting a new deadline at 135.
        $runner->clock = 105.0;
        $this->assertSame(130.0, $runner->beginDeadline($context));
    }

    public function testProviderTimeoutIsClampedToTheRemainingTurnTime(): void
    {
        $config = new ProviderConfig(
            provider: ProviderConfig::PROVIDER_OPENAI,
            endpoint: 'https://example.test/v1',
            timeout: 300,
            connectTimeout: 10,
        );

        $bounded = $config->withTimeout(3);

        $this->assertSame(3, $bounded->timeout);
        $this->assertSame(3, $bounded->connectTimeout);
    }

    public function testToolTimeoutIsClampedWhenItStartsNearTheDeadline(): void
    {
        config()->set('everest.guzzle.timeout', 60);
        config()->set('everest.guzzle.archive_timeout', 900);
        config()->set('modules.ai.agent.max_tool_seconds', 90);

        $method = new \ReflectionMethod(ToolExecutor::class, 'clampNodeTimeouts');
        $previous = $method->invoke(app(ToolExecutor::class), 2);

        try {
            $this->assertSame(2, config('everest.guzzle.timeout'));
            $this->assertSame(2, config('everest.guzzle.archive_timeout'));
        } finally {
            config($previous);
        }
    }
}
