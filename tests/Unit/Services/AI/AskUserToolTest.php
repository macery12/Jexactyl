<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * `ask_user` suspends a turn to put a question to the person driving it.
 *
 * It reuses the approval machinery, which means it inherits its guarantees —
 * the answer has to come back under the id the model issued, and the options
 * the user is offered have to be the ones that were persisted, not whatever a
 * later request claims they were.
 */
class AskUserToolTest extends TestCase
{
    private function definition(): ToolDefinition
    {
        return SharedTools::all()[0];
    }

    public function testItIsHostHandledAndHasNoRoute(): void
    {
        $definition = $this->definition();

        $this->assertTrue($definition->hostHandled);
        $this->assertSame('', $definition->uriTemplate);
        $this->assertSame('', $definition->method);
        $this->assertSame([], $definition->permissions);
    }

    /**
     * Shared scope is what puts it on both surfaces; anything else would give
     * one of the two assistants no way to ask a question at all.
     */
    public function testItIsOfferedOnEverySurface(): void
    {
        $definition = $this->definition();

        $this->assertTrue($definition->inScope(ToolDefinition::SCOPE_SERVER));
        $this->assertTrue($definition->inScope(ToolDefinition::SCOPE_ADMIN));
    }

    /**
     * Options arrive as model output and are rendered as buttons. A blank label
     * would draw an unclickable one, and a bare string is a common local-model
     * shape for what the schema declares as an object.
     */
    public function testOptionsAreNormalisedAndBlanksDropped(): void
    {
        $options = SharedTools::normaliseOptions([
            ['label' => 'Monthly', 'description' => 'Bill every month'],
            ['label' => '  '],
            ['label' => 'Yearly', 'description' => '   '],
            'Quarterly',
            42,
        ]);

        $this->assertSame([
            ['label' => 'Monthly', 'description' => 'Bill every month'],
            ['label' => 'Yearly'],
            ['label' => 'Quarterly'],
            ['label' => '42'],
        ], $options);
    }

    public function testNonArrayOptionsDoNotBlowUp(): void
    {
        $this->assertSame([], SharedTools::normaliseOptions(null));
        $this->assertSame([], SharedTools::normaliseOptions('nope'));
    }

    /**
     * A question costs a whole step out of twelve, plus a model call. Without a
     * cap an unsure model will spend the turn asking rather than looking.
     */
    public function testThereIsAQuestionBudget(): void
    {
        $this->assertGreaterThan(0, SharedTools::MAX_QUESTIONS_PER_TURN);
        $this->assertLessThan(5, SharedTools::MAX_QUESTIONS_PER_TURN);
    }

    /**
     * The count has to survive the suspension, or resuming would reset the
     * budget and the cap would never bind.
     */
    public function testTheQuestionCountSurvivesASuspension(): void
    {
        $context = new AgentContext(new User(), new Server(), 'turn-uuid');
        $context->questions = 2;
        $context->step = 4;

        $restored = AgentContext::fromState(new User(), new Server(), 'turn-uuid', null, $context->toState());

        $this->assertSame(2, $restored->questions);
        $this->assertSame(4, $restored->step);
    }

    /**
     * A question is answered by pushing a tool result under the model's own id,
     * exactly as an approval is — so the sibling-call bookkeeping that broke
     * resume once already has to keep working for it.
     */
    public function testAnAnsweredQuestionLeavesNoUnresolvedCall(): void
    {
        $context = (new AgentContext(new User(), null, 'turn-uuid'))->withMessages([
            AiMessage::user('add a coupon'),
            AiMessage::assistant(null, [new AiToolCall('toolu_09', SharedTools::ASK_USER, [])]),
        ]);

        $this->assertCount(1, $context->unresolvedToolCalls());

        $context->push(AiMessage::tool('toolu_09', SharedTools::ASK_USER, '{"ok":true,"answer":"Renewals"}'));

        $this->assertSame([], $context->unresolvedToolCalls());
    }
}
