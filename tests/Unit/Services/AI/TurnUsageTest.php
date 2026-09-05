<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Services\AI\Agent\AgentContext;

/**
 * What a turn cost.
 *
 * The agent loop is many model calls behind one usage row, so unless the calls
 * are summed the row reports nothing — which is how the panel came to show
 * "0 tokens" against thousands of real ones, and how the monthly token budget
 * came to be enforced against a column that was always zero on precisely the
 * workload that spends the most.
 */
class TurnUsageTest extends TestCase
{
    private function context(): AgentContext
    {
        return new AgentContext(User::factory()->make(['id' => 1]), null, 'turn-1');
    }

    public function testAFreshTurnHasCostNothing(): void
    {
        $this->assertSame(
            ['prompt_tokens' => 0, 'completion_tokens' => 0, 'total_tokens' => 0],
            $this->context()->usage
        );
    }

    public function testEveryCallInATurnIsCharged(): void
    {
        $context = $this->context();

        $context->addUsage(['prompt_tokens' => 1200, 'completion_tokens' => 80, 'total_tokens' => 1280]);
        $context->addUsage(['prompt_tokens' => 1600, 'completion_tokens' => 40, 'total_tokens' => 1640]);
        $context->addUsage(['prompt_tokens' => 1900, 'completion_tokens' => 220, 'total_tokens' => 2120]);

        // Not 2120. Reading the cost off the last call would report a
        // three-step turn as costing whatever step three happened to cost.
        $this->assertSame(5040, $context->usage['total_tokens']);
        $this->assertSame(4700, $context->usage['prompt_tokens']);
        $this->assertSame(340, $context->usage['completion_tokens']);
    }

    /**
     * Some providers report the halves and leave the addition to the caller.
     */
    public function testAMissingTotalIsDerivedRatherThanLeftAtZero(): void
    {
        $context = $this->context();

        $context->addUsage(['prompt_tokens' => 900, 'completion_tokens' => 100]);

        $this->assertSame(1000, $context->usage['total_tokens']);
    }

    /**
     * A streamed OpenAI-compatible call with usage reporting disabled sends
     * nothing at all. That must not corrupt what has already been counted.
     */
    public function testACallThatReportsNothingChargesNothing(): void
    {
        $context = $this->context();

        $context->addUsage(['prompt_tokens' => 500, 'completion_tokens' => 50, 'total_tokens' => 550]);
        $context->addUsage([]);

        $this->assertSame(550, $context->usage['total_tokens']);
    }

    /**
     * A turn that suspends for an approval and resumes is still one turn. If
     * the tally did not survive the round trip the operator would be billed for
     * the steps after the approval and nothing before it — and an approval
     * lands precisely on the expensive turns.
     */
    public function testCostSurvivesSuspendAndResume(): void
    {
        $context = $this->context();
        $context->addUsage(['prompt_tokens' => 3000, 'completion_tokens' => 200, 'total_tokens' => 3200]);

        $resumed = AgentContext::fromState(
            User::factory()->make(['id' => 1]),
            null,
            'turn-1',
            null,
            $context->toState()
        );

        $this->assertSame(3200, $resumed->usage['total_tokens']);
        $this->assertSame(3000, $resumed->usage['prompt_tokens']);

        $resumed->addUsage(['prompt_tokens' => 400, 'completion_tokens' => 30, 'total_tokens' => 430]);

        $this->assertSame(3630, $resumed->usage['total_tokens']);
    }

    /**
     * State written before this existed has no usage key at all.
     */
    public function testStateWithoutAUsageKeyRestoresToZero(): void
    {
        $resumed = AgentContext::fromState(
            User::factory()->make(['id' => 1]),
            null,
            'turn-1',
            null,
            ['messages' => [], 'step' => 2]
        );

        $this->assertSame(0, $resumed->usage['total_tokens']);
    }
}
