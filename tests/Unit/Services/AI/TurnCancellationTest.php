<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Models\AiUsageLog;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\TurnCancellations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;

/**
 * Stopping a turn (DESIGN-003).
 *
 * Until now Stop aborted the browser's `fetch` and nothing else: the turn went
 * on thinking, went on spending budget, and went on running tools against a
 * reader who had asked it to stop. The button told the truth about what it did
 * — "stopped watching" — which is not what anybody pressing it means.
 *
 * Two properties, and they are in tension, so most of this file is about where
 * the line between them falls:
 *
 * 1. A stop must **reach the turn**, across a process boundary, durably.
 * 2. A stop must **never land mid-effect**. Tools are HTTP calls through the
 *    panel's own middleware, several against a remote node; none of them can be
 *    un-started. So cancellation is observed only where nothing is half-done.
 */
class TurnCancellationTest extends TestCase
{
    use RefreshDatabase;

    /*
    |--------------------------------------------------------------------------
    | The request, and who may make it
    |--------------------------------------------------------------------------
    */

    public function testARunningTurnRecordsTheRequestOnceHoweverOftenItIsAsked(): void
    {
        $usage = $this->usage('running');
        $cancellations = new TurnCancellations();

        $this->assertTrue($cancellations->request($usage));
        $usage->refresh();
        $this->assertNotNull($usage->cancel_requested_at);

        $askedAt = $usage->cancel_requested_at;

        // Two people racing the button, or one impatient person, produce one
        // request — and crucially do not move the timestamp, which is the
        // record of when the user actually asked.
        $this->assertFalse((new TurnCancellations())->request($usage->fresh()));
        $this->assertEquals($askedAt, $usage->fresh()->cancel_requested_at);
    }

    public function testATurnThatAlreadyFinishedIsNotRetroactivelyCancelled(): void
    {
        foreach (['success', 'error', 'suspended'] as $status) {
            $usage = $this->usage($status);

            $this->assertFalse((new TurnCancellations())->request($usage), $status);
            $this->assertNull($usage->fresh()->cancel_requested_at, $status);
            $this->assertSame($status, $usage->fresh()->status, $status);
        }
    }

    public function testTheRunningTurnObservesARequestMadeByAnotherProcess(): void
    {
        $usage = $this->usage('running');

        // The reader is a different instance on purpose: the asking request and
        // the running turn are different PHP processes, and a flag held in
        // memory would reach neither.
        $reader = new TurnCancellations();
        $this->assertFalse($reader->requested($usage->turn_id));

        (new TurnCancellations())->request($usage);

        // Reads are throttled, so the observation is not instant by design.
        // Latching is what makes that safe: it is checked at boundaries seconds
        // apart, and once seen it never un-happens.
        $this->travelTo(now()->addSeconds(2));
        usleep(1_100_000);
        $this->assertTrue($reader->requested($usage->turn_id));
    }

    public function testACancellationReadThatFailsDoesNotEndTheTurn(): void
    {
        // Fail open, deliberately: a database that cannot answer is not
        // evidence that the user pressed Stop, and treating it as though it
        // were would end every turn in flight the moment the connection
        // wobbled. The record is the column, and it stays written.
        \Illuminate\Support\Facades\DB::shouldReceive('connection')->andThrow(new \RuntimeException('gone'));

        $this->assertFalse((new TurnCancellations())->requested('90000000-0000-4000-8000-000000000001'));
    }

    /*
    |--------------------------------------------------------------------------
    | Where the turn observes it
    |--------------------------------------------------------------------------
    */

    public function testTheContextLatchesTheStopSoEveryLaterCheckpointAgrees(): void
    {
        $context = new AgentContext($this->user(), $this->server(), 'turn-cancel-latch');
        $runner = $this->runnerThatIsStopped($asked = new StopsOnce());
        $stopRequested = new \ReflectionMethod(AgentRunner::class, 'stopRequested');

        $this->assertFalse($context->cancelled);
        $this->assertTrue($stopRequested->invoke($runner, $context));
        $this->assertTrue($context->cancelled);

        // The flag was only ever true once. Every later checkpoint must still
        // agree, or a turn would resume running after being told to stop.
        $this->assertSame(1, $asked->asked);
        $this->assertTrue($stopRequested->invoke($runner, $context));
        $this->assertSame(1, $asked->asked, 'A latched stop must not be re-read.');
    }

    /**
     * A batch stops scheduling rather than aborting.
     *
     * The children are independent HTTP calls with no transaction spanning
     * them; there is nothing to roll back and no inverse to invent. Batches are
     * already explicitly partial, so a stop needs no new outcome — it is simply
     * a reason a child did not run, reported in the same ledger as every other.
     */
    public function testAStoppedBatchRunsNoFurtherChildrenAndSaysWhy(): void
    {
        $context = new AgentContext($this->user(), $this->server(), 'turn-cancel-batch');
        $runner = $this->runnerThatIsStopped(new StopsAlways());
        $arguments = [
            'summary' => 'Read the config files',
            'calls' => [
                ['tool' => 'files_read', 'arguments' => ['file' => 'config/0.yml']],
                ['tool' => 'files_read', 'arguments' => ['file' => 'config/1.yml']],
            ],
        ];

        $result = (new \ReflectionMethod(AgentRunner::class, 'runBatch'))->invoke(
            $runner,
            $context,
            new ToolCallData('call_batch', SharedTools::BATCH, $arguments),
            $arguments,
            ToolDefinition::RISK_SAFE,
            fn () => null,
        );

        $this->assertFalse($result->ok);
        $this->assertSame('failed', $result->outcome);
        $this->assertSame(0, $result->data['succeeded']);
        $this->assertSame(0, $result->data['failed']);
        $this->assertSame(2, $result->data['not_run']);

        // Never omitted. A child that did not run is a fact the user is owed,
        // and the model needs it to decide what to say next.
        foreach ($result->data['calls'] as $child) {
            $this->assertSame('cancelled', $child['not_run']);
        }
    }

    public function testCallsAStopLeftUnrunAreAnsweredSoTheTranscriptStaysUsable(): void
    {
        $context = new AgentContext($this->user(), $this->server(), 'turn-cancel-unrun');
        $context->push(AiMessage::assistant(null, [
            new ToolCallData('call-a', 'files_read', ['file' => 'a']),
            new ToolCallData('call-b', 'files_read', ['file' => 'b']),
        ]));

        (new \ReflectionMethod(AgentRunner::class, 'answerUnrunCalls'))->invoke(
            $this->runnerThatIsStopped(new StopsAlways()),
            $context,
        );

        // An assistant message whose tool calls were never answered is one every
        // provider rejects. Leaving them open would make the *next* turn fail on
        // a conversation that only stopped.
        $this->assertSame([], $context->unresolvedToolCalls());

        $answers = array_values(array_filter(
            $context->messages,
            fn (AiMessage $message) => $message->role === 'tool',
        ));
        $this->assertCount(2, $answers);

        foreach ($answers as $answer) {
            $decoded = json_decode((string) $answer->content, true);
            $this->assertFalse($decoded['ok']);
            $this->assertSame('cancelled', $decoded['error']);
        }
    }

    /*
    |--------------------------------------------------------------------------
    | What the stream records
    |--------------------------------------------------------------------------
    */

    public function testAStoppedTurnIsRecordedAsCancelledRatherThanFailedOrBilledAsSuccess(): void
    {
        $user = User::factory()->create();
        $turnId = '91000000-0000-4000-8000-000000000001';

        $body = $this->streamCancelledTurn($user, $turnId);

        $usage = AiUsageLog::where('turn_id', $turnId)->firstOrFail();

        // Its own terminal state. "The user stopped it" and "it broke" are
        // different facts, and an operator reading a usage row is entitled to
        // know which one happened — the old behaviour could only say `error`.
        $this->assertSame('cancelled', $usage->status);
        $this->assertNull($usage->error_message);

        // A stop is a clean ending: the stream closes with the sentinel, which
        // is what tells the client the terminal state is persisted.
        $this->assertStringContainsString('data: [DONE]', $body);
        $this->assertStringNotContainsString('"type":"error"', $body);
    }

    public function testTheSlotIsHandedBackWhenTheStreamEndsHoweverItEnds(): void
    {
        $user = User::factory()->create();
        $gate = $this->app->make(\Everest\Services\AI\Inference\InferenceGate::class);

        config()->set('modules.ai.provider', \Everest\Services\AI\Data\ProviderConfig::PROVIDER_OLLAMA);
        config()->set('modules.ai.concurrency.slots', 1);
        config()->set('modules.ai.concurrency.per_user', 0);
        \Illuminate\Support\Facades\Cache::flush();

        $admission = $gate->admit('slot-owner');
        $this->assertTrue($admission->granted());
        $this->assertSame(1, $gate->slotsInUse());

        $runner = new class () extends AgentRunner {
            public function __construct()
            {
            }

            public function run(AgentContext $context, callable $emit): void
            {
                throw new \RuntimeException('the turn died holding the slot');
            }
        };
        $this->app->instance(AgentRunner::class, $runner);

        $response = (new AgentTurnOutcomeHarness())->stream(
            new AgentContext($user, null, '91000000-0000-4000-8000-000000000002'),
            $admission->lease,
        );

        ob_start();
        ob_start();
        $response->sendContent();
        ob_end_flush();
        ob_end_clean();

        // The slot is taken before the turn is built, so it has to be given
        // back on every path out — including the ones that threw before the
        // loop ever ran. Leaking one costs the next user the whole lease TTL.
        $this->assertSame(0, $gate->slotsInUse());
    }

    /*
    |--------------------------------------------------------------------------
    | Who may stop what
    |--------------------------------------------------------------------------
    */

    public function testATurnBelongingToSomebodyElseCannotBeStopped(): void
    {
        $usage = $this->usage('running');
        $stranger = User::factory()->create();

        // Scoped exactly as the status endpoint is: a turn one user may read is
        // precisely the turn that user may stop.
        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);

        try {
            (new AgentTurnOutcomeHarness())->cancel(
                $stranger,
                $usage->turn_id,
                null,
                ToolDefinition::SCOPE_ADMIN,
            );
        } finally {
            $this->assertNull($usage->fresh()->cancel_requested_at);
        }
    }

    public function testAnAdminTurnCannotBeStoppedThroughAServerScopedRequest(): void
    {
        $usage = $this->usage('running');
        $owner = User::find($usage->user_id);
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);

        try {
            (new AgentTurnOutcomeHarness())->cancel(
                $owner,
                $usage->turn_id,
                $server,
                ToolDefinition::SCOPE_SERVER,
            );
        } finally {
            $this->assertNull($usage->fresh()->cancel_requested_at);
        }
    }

    public function testASuspendedTurnIsSentBackToItsApprovalRatherThanStopped(): void
    {
        $usage = $this->usage('suspended');
        $owner = User::find($usage->user_id);

        try {
            (new AgentTurnOutcomeHarness())->cancel($owner, $usage->turn_id, null, ToolDefinition::SCOPE_ADMIN);
            $this->fail('Stopping a suspended turn must not be quietly accepted.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            // Nothing is executing, so a stop would stop nothing. The decision
            // the user actually wants is the card in front of them.
            $this->assertSame(409, $e->getStatusCode());
            $this->assertStringContainsString('Decline the action instead', $e->getMessage());
        }

        $this->assertNull($usage->fresh()->cancel_requested_at);
    }

    public function testStoppingAnOwnedRunningTurnReportsTheRequestNotTheOutcome(): void
    {
        $usage = $this->usage('running');
        $owner = User::find($usage->user_id);

        $response = (new AgentTurnOutcomeHarness())->cancel(
            $owner,
            $usage->turn_id,
            null,
            ToolDefinition::SCOPE_ADMIN,
        );

        $payload = json_decode((string) $response->getContent(), true)['data'];

        $this->assertTrue($payload['cancel_requested']);
        // Still running, and honestly reported as such: asking and stopping are
        // different moments, and a tool already in flight always finishes.
        $this->assertSame('running', $payload['status']);
        $this->assertNotNull($usage->fresh()->cancel_requested_at);
    }

    /*
    |--------------------------------------------------------------------------
    | Fixtures
    |--------------------------------------------------------------------------
    */

    private function usage(string $status): AiUsageLog
    {
        return AiUsageLog::create([
            'user_id' => User::factory()->create()->id,
            'server_uuid' => null,
            'turn_id' => (string) \Illuminate\Support\Str::uuid(),
            'source' => 'admin-agent',
            'model' => 'test',
            'status' => $status,
            'step' => 1,
            'tool_calls_count' => 0,
        ]);
    }

    private function runnerThatIsStopped(TurnCancellations $cancellations): AgentRunner
    {
        $this->app->instance(TurnCancellations::class, $cancellations);

        return $this->app->make(AgentRunner::class);
    }

    private function user(): User
    {
        $user = \Mockery::mock(User::class)->makePartial();
        $user->shouldReceive('can')->andReturn(true);

        return $user;
    }

    private function server(): Server
    {
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';

        return $server;
    }

    /** Run a turn that stops itself, and return everything the stream wrote. */
    private function streamCancelledTurn(User $user, string $turnId): string
    {
        $runner = new class () extends AgentRunner {
            public function __construct()
            {
            }

            public function run(AgentContext $context, callable $emit): void
            {
                // What the real loop does at a checkpoint: latch, say so, and
                // return normally. There is nothing to unwind.
                $context->cancelled = true;
                $emit(AgentEvent::done('cancelled'));
            }
        };

        $this->app->instance(AgentRunner::class, $runner);

        $response = (new AgentTurnOutcomeHarness())->stream(new AgentContext($user, null, $turnId));

        ob_start();
        ob_start();
        $response->sendContent();
        ob_end_flush();

        return (string) ob_get_clean();
    }
}

/** Reports a stop the first time it is asked, and counts the asking. */
class StopsOnce extends TurnCancellations
{
    public int $asked = 0;

    public function requested(string $turnId): bool
    {
        return ++$this->asked === 1;
    }
}

class StopsAlways extends TurnCancellations
{
    public function requested(string $turnId): bool
    {
        return true;
    }
}
