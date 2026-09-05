<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolExecutor;
use Everest\Services\AI\Data\ProviderConfig;

class AgentDeadlineTest extends TestCase
{
    public function testApprovedBatchAndResumedLoopShareOneFakeClockDeadline(): void
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

            /** @return array{float, float, float, bool} */
            public function simulateApprovedBatchThenLoop(AgentContext $context): array
            {
                $batchDeadline = $this->beginDeadline($context);
                $this->clock += 25.0; // approved batch execution
                $loopDeadline = $this->beginDeadline($context);
                $remainingAtLoopEntry = $loopDeadline - $this->clock;
                $this->clock += 6.0; // following model loop tries to continue

                return [$batchDeadline, $loopDeadline, $remainingAtLoopEntry, $this->hasTime($context)];
            }
        };

        $context = new AgentContext(User::factory()->make(), null, 'turn-deadline');
        [$batchDeadline, $loopDeadline, $remaining, $canContinue] = $runner->simulateApprovedBatchThenLoop($context);

        $this->assertSame(130.0, $batchDeadline);
        $this->assertSame($batchDeadline, $loopDeadline);
        $this->assertSame(5.0, $remaining);
        $this->assertFalse($canContinue, 'The loop must stop at the batch deadline, not receive another 30 seconds.');
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

    public function testNineHundredSecondTurnAdvertisesACompatibleIdleWindow(): void
    {
        Setting::forget('settings::modules:ai:agent:max_wall_seconds');
        config()->set('modules.ai.agent.max_wall_seconds', 900);

        $this->assertSame(930, app(AgentRunner::class)->streamIdleSeconds());
    }
}
