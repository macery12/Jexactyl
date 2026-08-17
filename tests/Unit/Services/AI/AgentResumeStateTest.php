<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Agent\AgentContext;

/**
 * A turn that pauses for approval is answered on a later request, so the
 * messages it resumes with have to line up with the ones it left behind.
 * Providers enforce that strictly: every tool call must be answered, and
 * answered under the id the model itself issued.
 */
class AgentResumeStateTest extends TestCase
{
    private function context(array $messages): AgentContext
    {
        return (new AgentContext(new User(), new Server(), 'turn-uuid'))->withMessages($messages);
    }

    public function testAnUnansweredCallIsReportedAsUnresolved(): void
    {
        $context = $this->context([
            AiMessage::user('back this up'),
            AiMessage::assistant(null, [new AiToolCall('toolu_01', 'backups_create', [])]),
        ]);

        $unresolved = $context->unresolvedToolCalls();

        $this->assertCount(1, $unresolved);
        $this->assertSame('toolu_01', $unresolved[0]->id);
    }

    public function testAnAnsweredCallIsNotReportedAsUnresolved(): void
    {
        $context = $this->context([
            AiMessage::user('back this up'),
            AiMessage::assistant(null, [new AiToolCall('toolu_01', 'backups_create', [])]),
            AiMessage::tool('toolu_01', 'backups_create', '{"ok":true}'),
        ]);

        $this->assertSame([], $context->unresolvedToolCalls());
    }

    /**
     * The suspension case: the model asked for three tools at once, the first
     * ran, the second needed approval and the third never started. Leaving the
     * last two unanswered is what Anthropic rejects outright.
     */
    public function testOnlyTheCallsStillWaitingAreReturned(): void
    {
        $context = $this->context([
            AiMessage::user('tidy up'),
            AiMessage::assistant(null, [
                new AiToolCall('toolu_01', 'files_list', ['directory' => '/']),
                new AiToolCall('toolu_02', 'backups_create', []),
                new AiToolCall('toolu_03', 'files_read', ['path' => '/a']),
            ]),
            AiMessage::tool('toolu_01', 'files_list', '{"ok":true}'),
        ]);

        $this->assertSame(
            ['toolu_02', 'toolu_03'],
            array_map(fn (AiToolCall $c) => $c->id, $context->unresolvedToolCalls()),
        );
    }

    /**
     * Only the newest assistant turn is in question. Earlier steps of the same
     * turn were settled before the loop moved on, and re-answering them would
     * put duplicate results into the transcript.
     */
    public function testEarlierCompletedStepsAreNotRevisited(): void
    {
        $context = $this->context([
            AiMessage::user('go'),
            AiMessage::assistant(null, [new AiToolCall('toolu_01', 'files_list', [])]),
            AiMessage::tool('toolu_01', 'files_list', '{"ok":true}'),
            AiMessage::assistant(null, [new AiToolCall('toolu_02', 'backups_create', [])]),
        ]);

        $unresolved = $context->unresolvedToolCalls();

        $this->assertCount(1, $unresolved);
        $this->assertSame('toolu_02', $unresolved[0]->id);
    }

    public function testAPlainAnswerLeavesNothingUnresolved(): void
    {
        $context = $this->context([
            AiMessage::user('hello'),
            AiMessage::assistant('Hi — what would you like to do?'),
        ]);

        $this->assertSame([], $context->unresolvedToolCalls());
    }

    /**
     * The ids have to survive the round trip through `ai_pending_actions.state`
     * — that serialised form is all a resumed turn has to work from.
     */
    public function testToolCallIdsSurviveStateSerialisation(): void
    {
        $original = $this->context([
            AiMessage::user('back this up'),
            AiMessage::assistant(null, [new AiToolCall(
                'toolu_01',
                'backups_create',
                ['name' => 'nightly'],
                'batch-parent',
                2,
            )]),
        ]);

        $restored = AgentContext::fromState(new User(), new Server(), 'turn-uuid', 7, $original->toState());

        $this->assertSame('toolu_01', $restored->unresolvedToolCalls()[0]->id);
        $this->assertSame(['name' => 'nightly'], $restored->unresolvedToolCalls()[0]->arguments);
        $this->assertSame('batch-parent', $restored->unresolvedToolCalls()[0]->batchParentId);
        $this->assertSame(2, $restored->unresolvedToolCalls()[0]->batchIndex);
    }
}
