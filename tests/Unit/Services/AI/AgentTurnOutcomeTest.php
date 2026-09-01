<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\AiToolCall;
use Everest\Models\AiUsageLog;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolDefinition;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * What a turn leaves behind when it goes wrong.
 *
 * Three findings meet here, and they are the same question asked of three
 * records. A turn that failed must not be billed as a success (AI-026); no row
 * it touched may be left mid-flight with nobody to finish it (AI-029); and
 * nothing it says about the failure may carry panel internals, which APP_DEBUG
 * makes the default rather than the exception (AI-030).
 *
 * The runner is faked rather than driven, because the point under test is what
 * the stream owner does with a throw — every real way of producing one arrives
 * here identically.
 */
class AgentTurnOutcomeTest extends TestCase
{
    use RefreshDatabase;

    private const LEAKY = 'SQLSTATE[42S02]: Base table or view not found: 1146 '
        . "Table 'panel.ai_tool_calls' doesn't exist at /var/www/panel/app/Services/AI/Agent/AgentRunner.php:1284";

    /*
    |--------------------------------------------------------------------------
    | AI-026 — the recorded status is the turn's actual outcome
    |--------------------------------------------------------------------------
    */

    public function testASuccessfulTurnIsRecordedAsSuccess(): void
    {
        $user = User::factory()->create();
        $turnId = '10000000-0000-4000-8000-000000000001';

        $body = $this->stream($user, $turnId, null);

        $this->assertSame('success', AiUsageLog::where('turn_id', $turnId)->firstOrFail()->status);
        $this->assertStringContainsString('data: [DONE]', $body);
    }

    public function testAProviderTimeoutIsRecordedAsAnErrorAndQuotedToTheUser(): void
    {
        $user = User::factory()->create();
        $turnId = '10000000-0000-4000-8000-000000000002';
        $message = 'The AI is busy and did not free up in time. Please try again in a moment.';

        $body = $this->stream($user, $turnId, new AIServiceException($message));

        $usage = AiUsageLog::where('turn_id', $turnId)->firstOrFail();
        $this->assertSame('error', $usage->status);
        // Our own exceptions are written for this audience, so they survive
        // intact — that is the whole reason the type is distinguished.
        $this->assertStringStartsWith($message, (string) $usage->error_message);
        $this->assertMatchesRegularExpression(
            '/Administrator reference: [A-Z0-9]{10}\./',
            (string) $usage->error_message,
        );
        $this->assertStringContainsString($message, $body);
    }

    public function testAProviderExceptionIsRecordedAsAnError(): void
    {
        $user = User::factory()->create();
        $turnId = '10000000-0000-4000-8000-000000000003';

        $this->stream($user, $turnId, new \RuntimeException('cURL error 7: Failed to connect to 10.0.0.4 port 11434'));

        $this->assertSame('error', AiUsageLog::where('turn_id', $turnId)->firstOrFail()->status);
    }

    public function testAnInternalExceptionIsRecordedAsAnErrorRatherThanBilledAsSuccess(): void
    {
        $user = User::factory()->create();
        $turnId = '10000000-0000-4000-8000-000000000004';

        $this->stream($user, $turnId, new \RuntimeException(self::LEAKY));

        $usage = AiUsageLog::where('turn_id', $turnId)->firstOrFail();
        $this->assertSame('error', $usage->status);
        $this->assertNotSame('success', $usage->status);
    }

    /*
    |--------------------------------------------------------------------------
    | AI-030 — nothing internal leaves the panel
    |--------------------------------------------------------------------------
    */

    public function testInternalExceptionDetailReachesNeitherTheStreamNorTheStoredRow(): void
    {
        $user = User::factory()->create();
        $turnId = '20000000-0000-4000-8000-000000000001';

        $body = $this->stream($user, $turnId, new \RuntimeException(self::LEAKY));
        $stored = (string) AiUsageLog::where('turn_id', $turnId)->firstOrFail()->error_message;

        // The stored row is not private: `agentTurnStatus()` returns it to the
        // browser when a stream is lost, so it is held to the same bar as SSE.
        foreach (['SQLSTATE', 'panel.ai_tool_calls', '/var/www/panel', 'AgentRunner.php'] as $sentinel) {
            $this->assertStringNotContainsString($sentinel, $body, 'SSE: ' . $sentinel);
            $this->assertStringNotContainsString($sentinel, $stored, 'stored: ' . $sentinel);
        }

        $this->assertStringContainsString('internal panel error', $body);
        $this->assertStringContainsString('contact an administrator', $stored);
        $this->assertMatchesRegularExpression('/Administrator reference: [A-Z0-9]{10}\./', $stored);
    }

    /*
    |--------------------------------------------------------------------------
    | AI-029 — no record is left mid-flight
    |--------------------------------------------------------------------------
    */

    public function testACallLeftRunningByAFailedTurnBecomesTerminal(): void
    {
        $user = User::factory()->create();
        $turnId = '30000000-0000-4000-8000-000000000001';

        $running = AiToolCall::create([
            'turn_id' => $turnId,
            'user_id' => $user->id,
            'scope' => ToolDefinition::SCOPE_ADMIN,
            'tool_call_id' => 'call-1',
            'tool_name' => 'admin_product_update',
            'risk' => ToolDefinition::RISK_WRITE,
            'step' => 1,
            'arguments' => [],
            'status' => AiToolCall::STATUS_RUNNING,
        ]);

        $this->stream($user, $turnId, new \RuntimeException(self::LEAKY));

        $running->refresh();
        $this->assertSame(AiToolCall::STATUS_FAILED, $running->status);
        $this->assertNotNull($running->resolved_at);
    }

    public function testAFreshSuspensionIsNotClosedByAFailureLaterInTheSameTurn(): void
    {
        $user = User::factory()->create();
        $turnId = '30000000-0000-4000-8000-000000000002';

        // A turn can suspend again on its way out. That approval is live and
        // waiting on the user; only calls that were actually started may be
        // failed closed.
        $waiting = AiToolCall::create([
            'turn_id' => $turnId,
            'user_id' => $user->id,
            'scope' => ToolDefinition::SCOPE_ADMIN,
            'tool_call_id' => 'call-2',
            'tool_name' => 'admin_product_update',
            'risk' => ToolDefinition::RISK_WRITE,
            'step' => 2,
            'arguments' => [],
            'status' => AiToolCall::STATUS_PENDING_APPROVAL,
        ]);

        $this->stream($user, $turnId, new \RuntimeException('boom'));

        $this->assertSame(AiToolCall::STATUS_PENDING_APPROVAL, $waiting->refresh()->status);
    }

    public function testAClaimAbandonedBeforeExecutionIsClosedIdempotently(): void
    {
        $user = User::factory()->create();
        $turnId = '30000000-0000-4000-8000-000000000003';
        $pending = $this->pendingAction($user, $turnId);
        $audit = AiToolCall::create([
            'turn_id' => $turnId,
            'user_id' => $user->id,
            'scope' => ToolDefinition::SCOPE_ADMIN,
            'tool_call_id' => 'call-3',
            'tool_name' => 'admin_product_update',
            'risk' => ToolDefinition::RISK_WRITE,
            'step' => 1,
            'arguments' => [],
            'status' => AiToolCall::STATUS_PENDING_APPROVAL,
        ]);

        $harness = new AgentTurnOutcomeHarness();
        $this->assertTrue($harness->claim($pending));
        $this->assertSame(AiPendingAction::STATUS_EXECUTING, $pending->fresh()->status);

        $harness->abandon($pending);

        $pending->refresh();
        $this->assertSame(AiPendingAction::STATUS_FAILED, $pending->status);
        $this->assertNotNull($pending->resolved_at);
        $this->assertNotNull($pending->failure_reason);
        $this->assertSame(AiToolCall::STATUS_FAILED, $audit->refresh()->status);

        // Recovery has to be safe to repeat: the same request can unwind twice
        // through nested handlers, and a second pass must not rewrite a row
        // that has since moved on.
        $resolvedAt = $pending->resolved_at;
        $harness->abandon($pending);
        $this->assertSame(AiPendingAction::STATUS_FAILED, $pending->fresh()->status);
        $this->assertEquals($resolvedAt, $pending->fresh()->resolved_at);
    }

    public function testAbandoningACompletedClaimChangesNothing(): void
    {
        $user = User::factory()->create();
        $turnId = '30000000-0000-4000-8000-000000000004';
        $pending = $this->pendingAction($user, $turnId);

        $harness = new AgentTurnOutcomeHarness();
        $harness->claim($pending);
        $pending->update(['status' => AiPendingAction::STATUS_COMPLETED, 'resolved_at' => now()]);

        $harness->abandon($pending);

        $this->assertSame(AiPendingAction::STATUS_COMPLETED, $pending->fresh()->status);
    }

    /*
    |--------------------------------------------------------------------------
    | AI-033 — a decision has to fit the thing it is deciding
    |--------------------------------------------------------------------------
    */

    public function testAQuestionCannotBeApprovedAndAnApprovalCannotBeAnswered(): void
    {
        $user = User::factory()->create();
        $harness = new AgentTurnOutcomeHarness();

        $question = $this->pendingAction($user, '40000000-0000-4000-8000-000000000001', [
            'tool_name' => SharedTools::ASK_USER,
            'risk' => ToolDefinition::RISK_SAFE,
            'arguments' => ['question' => 'Which world?', 'options' => [['label' => 'A'], ['label' => 'B']]],
        ]);
        $approval = $this->pendingAction($user, '40000000-0000-4000-8000-000000000002');

        foreach ([[$question, 'approve'], [$approval, 'answer']] as [$row, $decision]) {
            try {
                $harness->assertDecision($row, $decision);
                $this->fail(sprintf('%s must not accept decision=%s.', $row->tool_name, $decision));
            } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
                $this->assertSame(422, $e->getStatusCode());
            }

            // And nothing about the row moved: a refused combination is not a
            // decision, so the action is still there to be decided properly.
            $this->assertSame(AiPendingAction::STATUS_PENDING, $row->fresh()->status);
        }

        // The combinations that do fit, plus the one both accept.
        $harness->assertDecision($question, 'answer');
        $harness->assertDecision($question, 'reject');
        $harness->assertDecision($approval, 'approve');
        $harness->assertDecision($approval, 'reject');
        $this->assertTrue(true);
    }

    public function testAnUnofferedAnswerIsRefusedBeforeTheRowIsClaimed(): void
    {
        $user = User::factory()->create();
        $harness = new AgentTurnOutcomeHarness();
        $question = $this->pendingAction($user, '40000000-0000-4000-8000-000000000003', [
            'tool_name' => SharedTools::ASK_USER,
            'risk' => ToolDefinition::RISK_SAFE,
            'arguments' => ['question' => 'Which world?', 'options' => [['label' => 'A'], ['label' => 'B']]],
        ]);

        try {
            $harness->assertAnswer($question, 'something else entirely');
            $this->fail('An answer outside the offered options must be refused.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }

        // The row is still decidable. Claiming first meant a mistyped answer
        // stranded the question in `executing` until its lease ran out.
        $this->assertSame(AiPendingAction::STATUS_PENDING, $question->fresh()->status);
        $this->assertNull($question->fresh()->execution_key);
        $this->assertSame('A', $harness->assertAnswer($question, 'a'));
    }

    /*
    |--------------------------------------------------------------------------
    | AI-034 — expiry is a transition, not a filter
    |--------------------------------------------------------------------------
    */

    public function testAnExpiredActionAndItsApprovalRowBecomeTerminal(): void
    {
        $user = User::factory()->create();
        $turnId = '50000000-0000-4000-8000-000000000001';
        $pending = $this->pendingAction($user, $turnId, ['expires_at' => now()->subMinute()]);
        $audit = AiToolCall::create([
            'turn_id' => $turnId,
            'user_id' => $user->id,
            'scope' => ToolDefinition::SCOPE_ADMIN,
            'tool_call_id' => 'call-5',
            'tool_name' => 'admin_product_update',
            'risk' => ToolDefinition::RISK_WRITE,
            'step' => 1,
            'arguments' => [],
            'status' => AiToolCall::STATUS_PENDING_APPROVAL,
        ]);

        $harness = new AgentTurnOutcomeHarness();

        $this->assertTrue($harness->expire($pending));
        $this->assertSame(AiPendingAction::STATUS_EXPIRED, $pending->fresh()->status);
        $this->assertSame(AiToolCall::STATUS_REJECTED, $audit->refresh()->status);
        $this->assertNotNull($audit->resolved_at);

        // Already terminal: a second attempt reports nothing to do rather than
        // rewriting the row, and the action can no longer be claimed.
        $this->assertFalse($harness->expire($pending->fresh()));
        $this->assertFalse($harness->claim($pending->fresh()));
    }

    public function testListingLapsedActionsSettlesThemRatherThanHidingThem(): void
    {
        $user = User::factory()->create();
        $lapsed = $this->pendingAction($user, '50000000-0000-4000-8000-000000000002', [
            'expires_at' => now()->subMinute(),
        ]);
        $live = $this->pendingAction($user, '50000000-0000-4000-8000-000000000003');
        $audit = AiToolCall::create([
            'turn_id' => $lapsed->turn_id,
            'user_id' => $user->id,
            'scope' => ToolDefinition::SCOPE_ADMIN,
            'tool_call_id' => 'call-6',
            'tool_name' => 'admin_product_update',
            'risk' => ToolDefinition::RISK_WRITE,
            'step' => 1,
            'arguments' => [],
            'status' => AiToolCall::STATUS_PENDING_APPROVAL,
        ]);

        (new AgentTurnOutcomeHarness())->sweep(
            AiPendingAction::query()->where('user_id', $user->id)
        );

        $this->assertSame(AiPendingAction::STATUS_EXPIRED, $lapsed->fresh()->status);
        $this->assertSame(AiToolCall::STATUS_REJECTED, $audit->refresh()->status);
        $this->assertSame(AiPendingAction::STATUS_PENDING, $live->fresh()->status);
    }

    /*
    |--------------------------------------------------------------------------
    | Fixtures
    |--------------------------------------------------------------------------
    */

    /** Run one turn's stream to completion and return everything it wrote. */
    private function stream(User $user, string $turnId, ?\Throwable $failure): string
    {
        $runner = new class () extends AgentRunner {
            public ?\Throwable $failure = null;

            public function __construct()
            {
            }

            public function run(AgentContext $context, callable $emit): void
            {
                if ($this->failure !== null) {
                    throw $this->failure;
                }

                $emit(AgentEvent::done('complete'));
            }
        };
        $runner->failure = $failure;

        $this->app->instance(AgentRunner::class, $runner);

        $context = new AgentContext($user, null, $turnId);
        $response = (new AgentTurnOutcomeHarness())->stream($context);

        // Two levels: `write()` flushes its own buffer, which lands in the
        // collector below it rather than on the terminal.
        ob_start();
        ob_start();
        $response->sendContent();
        ob_end_flush();

        return (string) ob_get_clean();
    }

    private function pendingAction(User $user, string $turnId, array $overrides = []): AiPendingAction
    {
        $conversation = AiConversation::create([
            'user_id' => $user->id,
            'server_uuid' => null,
            'scope' => AiConversation::SCOPE_ADMIN,
            'title' => 'Outcome',
            'expires_at' => now()->addDay(),
        ]);

        return AiPendingAction::create(array_merge([
            'turn_id' => $turnId,
            'conversation_id' => $conversation->id,
            'user_id' => $user->id,
            'server_uuid' => null,
            'scope' => ToolDefinition::SCOPE_ADMIN,
            'tool_name' => 'admin_product_update',
            'tool_call_id' => 'call-' . substr($turnId, 0, 8),
            'risk' => ToolDefinition::RISK_WRITE,
            'arguments' => [],
            'state' => [],
            'step' => 1,
            'status' => AiPendingAction::STATUS_PENDING,
            'expires_at' => now()->addMinutes(30),
        ], $overrides));
    }
}
