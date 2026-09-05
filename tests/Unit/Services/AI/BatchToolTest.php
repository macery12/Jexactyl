<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\ApprovalPreview;
use Everest\Services\AI\Agent\WorkingSetPlanner;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\PrerequisiteResolver;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;

/**
 * One approval over many calls.
 *
 * The feature exists because twenty product creations meant twenty approval
 * cards, and nobody reads card fifteen — which matters, because the card is the
 * only thing between the model and the panel. Reviewing less was never the
 * answer; reviewing the whole set at once, before any of it runs, is.
 *
 * So almost everything here is about the gate rather than the execution. A batch
 * is expanded, resolved and validated *before* the card is drawn, and refused
 * whole if any part of it fails — because a card promising twenty products that
 * dies on the seventh is worse than twenty cards. By then the user has spent the
 * attention the card exists to collect, and has been told something happened
 * that did not.
 */
class BatchToolTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();
        Setting::forget('settings::modules:ai:risk_overrides');
        Setting::forget('settings::modules:ai:disabled_tools');
    }

    private function registry(): ToolRegistry
    {
        $authorizer = \Mockery::mock(AdminAuthorizer::class);
        $authorizer->shouldReceive('hasCapability')->andReturn(true);
        $authorizer->shouldReceive('isOwner')->andReturn(true);

        return new ToolRegistry(new RiskGate(new ConsoleCommandGate()), new SchemaValidator(), $authorizer);
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

    private function context(): AgentContext
    {
        return new AgentContext($this->user(), $this->server(), 'turn-batch-test');
    }

    /**
     * The tools a server turn offers, which is what a batch's children are
     * checked against.
     *
     * @return ToolDefinition[]
     */
    private function offered(): array
    {
        // The whole permitted catalogue, not a working set. A batch's children
        // are checked against what the *step* offered, and this harness is about
        // the plan-time gate rather than about retrieval — passing everything
        // keeps a batch test from failing for a reason that has nothing to do
        // with batching.
        return $this->registry()->forServer($this->user(), $this->server());
    }

    /**
     * `AgentRunner::planBatch()` — the gate everything below is about.
     *
     * @param ToolDefinition[]|null $offered
     *
     * @return ToolResult|array{0: array, 1: string}
     */
    private function plan(array $arguments, ?array $offered = null): ToolResult|array
    {
        $method = new \ReflectionMethod(AgentRunner::class, 'planBatch');

        return $method->invoke(app(AgentRunner::class), $arguments, $offered ?? $this->offered());
    }

    /**
     * A batch of file reads — safe, valid, and the smallest thing that passes.
     */
    private function reads(int $count = 2): array
    {
        $calls = [];

        for ($i = 0; $i < $count; ++$i) {
            $calls[] = ['tool' => 'files_read', 'arguments' => ['file' => sprintf('config/%d.yml', $i)]];
        }

        return ['summary' => 'Read the config files', 'calls' => $calls];
    }

    /*
    |--------------------------------------------------------------------------
    | What is on offer
    |--------------------------------------------------------------------------
    */

    public function testBothSurfacesOfferTheBatchTool(): void
    {
        $registry = $this->registry();
        $user = $this->user();

        $server = array_map(
            fn (ToolDefinition $d) => $d->name,
            $registry->forServer($user, $this->server())
        );
        $admin = array_map(fn (ToolDefinition $d) => $d->name, $registry->forAdmin($user));

        // The user's assistant and the administrator's get it from one shared
        // definition, so the card and the rules behind it cannot drift apart.
        $this->assertContains(SharedTools::BATCH, $server);
        $this->assertContains(SharedTools::BATCH, $admin);
    }

    /** Tiny starts with only the essential controls; batch remains discoverable. */
    public function testTinyCoreOmitsBatchAndLoadTools(): void
    {
        $planner = new WorkingSetPlanner(app(ToolRegistry::class), new PrerequisiteResolver());

        $offered = $planner->plan($this->context(), 0)->names();

        $this->assertContains(SharedTools::ASK_USER, $offered);
        $this->assertContains(SharedTools::SEARCH_TOOLS, $offered);
        $this->assertNotContains(SharedTools::BATCH, $offered);
        $this->assertNotContains(SharedTools::LOAD_TOOLS, $offered);
    }

    /*
    |--------------------------------------------------------------------------
    | The gate
    |--------------------------------------------------------------------------
    */

    public function testFileWritesCannotBypassExactDiffReviewThroughABatch(): void
    {
        $plan = $this->plan([
            'summary' => 'Fix the two config files',
            'calls' => [
                ['tool' => 'files_read', 'arguments' => ['file' => 'server.properties']],
                [
                    'tool' => 'files_write',
                    'arguments' => [
                        'file' => 'server.properties',
                        'content' => 'max-players=40',
                        'original_content' => 'max-players=20',
                    ],
                ],
            ],
        ]);

        $this->assertInstanceOf(ToolResult::class, $plan);
        $this->assertFalse($plan->ok);
        $this->assertSame('not_batchable', $plan->code);
        $this->assertStringContainsString('exact live diff', (string) $plan->detail);
    }

    public function testABatchOfReadsStaysSafeAndSoRunsWithoutACard(): void
    {
        [, $risk] = $this->plan($this->reads(3));

        // Worth having on its own: five lookups in one step instead of five
        // steps, and nothing to approve because nothing changes.
        $this->assertSame(ToolDefinition::RISK_SAFE, $risk);
        $this->assertTrue(app(RiskGate::class)->runsAutomatically($risk));
    }

    public function testAToolTheUserWasNotOfferedCannotBeReachedByNestingIt(): void
    {
        // `admin_product_create` is real, and resolves in the registry — it is
        // simply not on offer for a server turn. Nesting must not be a way past
        // the same check a direct call gets.
        $plan = $this->plan([
            'summary' => 'Create some products',
            'calls' => [
                ['tool' => 'admin_product_create', 'arguments' => ['category' => '1']],
                ['tool' => 'admin_product_create', 'arguments' => ['category' => '1']],
            ],
        ]);

        $this->assertInstanceOf(ToolResult::class, $plan);
        $this->assertFalse($plan->ok);
        $this->assertSame('unknown_tool', $plan->code);
    }

    public function testAnInventedToolNamesTheCallItCameFrom(): void
    {
        $plan = $this->plan([
            'summary' => 'Do the thing',
            'calls' => [
                ['tool' => 'files_read', 'arguments' => ['file' => 'a.yml']],
                ['tool' => 'files_teleport', 'arguments' => []],
            ],
        ]);

        $this->assertInstanceOf(ToolResult::class, $plan);
        // The position matters: "one of your calls is wrong" is not something a
        // model can act on, and it will usually resend the same batch.
        $this->assertStringContainsString('Call 2', (string) $plan->detail);
        $this->assertTrue($plan->retryable);
    }

    /**
     * Host-handled tools suspend, bind, or widen a grant, and none of that
     * survives being nested inside something that is itself waiting to be
     * approved. The assist tools are the sharp end: one click must never both
     * open a session on a customer's server and change things on it, because
     * those changes were written before the model had seen anything there.
     */
    public function testHostHandledToolsCannotBeBatched(): void
    {
        foreach ([SharedTools::ASK_USER, SharedTools::BATCH, AdminTools::ASSIST_SERVER] as $tool) {
            $plan = $this->plan(
                [
                    'summary' => 'Nest it',
                    'calls' => [
                        ['tool' => 'files_read', 'arguments' => ['file' => 'a.yml']],
                        ['tool' => $tool, 'arguments' => []],
                    ],
                ],
                array_merge($this->offered(), [$this->registry()->find($tool)]),
            );

            $this->assertInstanceOf(ToolResult::class, $plan, $tool . ' should not be batchable.');
            $this->assertFalse($plan->ok);
        }
    }

    public function testABadArgumentRefusesTheWholeBatchRatherThanPartOfIt(): void
    {
        $plan = $this->plan([
            'summary' => 'Read two files',
            'calls' => [
                ['tool' => 'files_read', 'arguments' => ['file' => 'server.properties']],
                ['tool' => 'files_read', 'arguments' => []],
            ],
        ]);

        $this->assertInstanceOf(ToolResult::class, $plan);
        $this->assertSame('invalid_arguments', $plan->code);
        $this->assertTrue($plan->retryable);
        // Nothing is drawn and nothing is dropped: the model rewrites the batch,
        // which is the only outcome that keeps the card honest.
        $this->assertStringContainsString('whole batch', (string) $plan->detail);
    }

    public function testABatchMayNotExceedTheConfiguredSize(): void
    {
        config()->set('modules.ai.agent.max_batch_calls', 3);

        $plan = $this->plan($this->reads(4));

        $this->assertInstanceOf(ToolResult::class, $plan);
        $this->assertSame('batch_too_large', $plan->code);
        // Splitting is something the model can actually do, so the refusal says
        // so rather than only reporting the limit.
        $this->assertStringContainsString('second batch', (string) $plan->detail);
    }

    public function testASingleCallIsNotABatch(): void
    {
        $plan = $this->plan($this->reads(1));

        $this->assertInstanceOf(ToolResult::class, $plan);
        // Otherwise the model wraps everything, putting back the indirection
        // that offering tools flat exists to remove.
        $this->assertSame('invalid_arguments', $plan->code);
    }

    public function testDestructiveCallsAreRefusedUnlessTheOperatorAllowsThem(): void
    {
        $batch = [
            'summary' => 'Clear out the old worlds',
            'calls' => [
                ['tool' => 'files_delete', 'arguments' => ['root' => '/', 'files' => ['world_old']]],
                ['tool' => 'files_delete', 'arguments' => ['root' => '/', 'files' => ['world_older']]],
            ],
        ];

        config()->set('modules.ai.agent.allow_destructive_batches', false);
        $refused = $this->plan($batch);

        $this->assertInstanceOf(ToolResult::class, $refused);
        $this->assertSame('not_batchable', $refused->code);

        config()->set('modules.ai.agent.allow_destructive_batches', true);
        $allowed = $this->plan($batch);

        $this->assertIsArray($allowed, 'An operator who turned it on should get the batch.');
        // Still destructive, so still behind the typed confirmation — once, over
        // a card that names every target.
        $this->assertSame(ToolDefinition::RISK_DESTRUCTIVE, $allowed[1]);
    }

    public function testOnErrorOnlyEverReadsAsOneOfTwoThings(): void
    {
        [$continues] = $this->plan($this->reads(2) + ['on_error' => 'continue']);
        [$nonsense] = $this->plan($this->reads(2) + ['on_error' => 'sometimes']);

        $this->assertSame('continue', $continues['on_error']);
        // Anything unrecognised falls back to stopping, which is the answer that
        // cannot compound a mistake.
        $this->assertSame('stop', $nonsense['on_error']);
    }

    /*
    |--------------------------------------------------------------------------
    | What changed while the card was open
    |--------------------------------------------------------------------------
    */

    private function execute(AgentContext $context, array $arguments, string $approvedRisk): ToolResult
    {
        $method = new \ReflectionMethod(AgentRunner::class, 'runBatch');

        return $method->invoke(
            app(AgentRunner::class),
            $context,
            new ToolCallData('call_batch', SharedTools::BATCH, $arguments),
            $arguments,
            $approvedRisk,
            fn () => null,
        );
    }

    public function testBatchChildrenUseTurnBoundIdsAndKeepTheirLineage(): void
    {
        $method = new \ReflectionMethod(AgentRunner::class, 'batchChildCall');
        $context = $this->context();
        $parent = new ToolCallData('provider.0', SharedTools::BATCH, []);

        /** @var ToolCallData $child */
        $child = $method->invoke(app(AgentRunner::class), $context, $parent, 0, 'files_read', ['file' => 'a']);
        /** @var ToolCallData $sameRetry */
        $sameRetry = $method->invoke(app(AgentRunner::class), $context, $parent, 0, 'files_read', ['file' => 'a']);
        $context->step = 2;
        /** @var ToolCallData $laterStep */
        $laterStep = $method->invoke(app(AgentRunner::class), $context, $parent, 0, 'files_read', ['file' => 'a']);

        $this->assertSame($child->id, $sameRetry->id);
        $this->assertNotSame($child->id, $laterStep->id);
        $this->assertNotSame('provider.0', $child->id);
        $this->assertNotSame('provider.0.0', $child->id);
        $this->assertSame('provider.0', $child->batchParentId);
        $this->assertSame(0, $child->batchIndex);

        // AI-040. The exact collision, end to end: a provider emitting the
        // top-level id `x.0` alongside a batch whose parent is `x`. Under the
        // old `parent.index` convention those were the same string.
        $this->assertTrue(ToolCallData::isDerivedId($child->id));
        $this->assertFalse(ToolCallData::isDerivedId('provider.0'));
        $this->assertFalse(ToolCallData::isDerivedId('provider.0.0'));
    }

    /**
     * An approval is a ceiling, not a token: what the user agreed to is a tier,
     * and nothing inside the batch may exceed it when the time comes to run.
     *
     * The whole batch stops rather than the offending call, because a batch that
     * half-ran because something changed underneath it is worse than one that
     * did not run — the user is left reconciling a partial write against a card
     * that described a whole one.
     */
    public function testACallAboveTheApprovedTierAbortsTheWholeBatch(): void
    {
        config()->set('modules.ai.agent.allow_destructive_batches', true);

        [$arguments, $risk] = $this->plan([
            'summary' => 'Clear out the old worlds',
            'calls' => [
                ['tool' => 'files_delete', 'arguments' => ['root' => '/', 'files' => ['world_old']]],
                ['tool' => 'files_delete', 'arguments' => ['root' => '/', 'files' => ['world_older']]],
            ],
        ]);

        $this->assertSame(ToolDefinition::RISK_DESTRUCTIVE, $risk);

        // Approved as a write — which is what a stored pending action would say
        // if the tool had been relaxed when the card was drawn and hardened
        // again before the click landed.
        $result = $this->execute($this->context(), $arguments, ToolDefinition::RISK_WRITE);

        $this->assertFalse($result->ok);
        $this->assertSame('risk_changed', $result->code);
        $this->assertStringContainsString('none of it was run', (string) $result->detail);
    }

    /**
     * Permissions are re-asked at the point of running, not trusted from the
     * moment the batch was offered. An approval can sit on screen for minutes.
     */
    public function testACallTheUserCanNoLongerMakeAbortsTheWholeBatch(): void
    {
        [$arguments] = $this->plan($this->reads(2));

        $revoked = \Mockery::mock(User::class)->makePartial();
        $revoked->shouldReceive('can')->andReturn(false);

        $context = new AgentContext($revoked, $this->server(), 'turn-batch-revoked');

        $result = $this->execute($context, $arguments, ToolDefinition::RISK_SAFE);

        $this->assertFalse($result->ok);
        $this->assertSame('forbidden', $result->code);
    }

    public function testACallThatNoLongerExistsAbortsTheWholeBatch(): void
    {
        $result = $this->execute(
            $this->context(),
            [
                'summary' => 'Read two files',
                'calls' => [
                    ['tool' => 'files_read', 'arguments' => ['file' => 'a.yml']],
                    ['tool' => 'files_retired', 'arguments' => []],
                ],
                'on_error' => 'continue',
            ],
            ToolDefinition::RISK_SAFE,
        );

        $this->assertFalse($result->ok);
        $this->assertSame('unavailable', $result->code);
        // Even under `continue`: the pre-flight is about the batch being what it
        // said it was, and `continue` only governs a call that genuinely failed.
        $this->assertStringContainsString('none of this batch was run', (string) $result->detail);
    }

    public function testDisablingAChildWhileTheCardIsOpenAbortsTheWholeBatch(): void
    {
        [$arguments] = $this->plan($this->reads(2));
        Setting::set('settings::modules:ai:disabled_tools', json_encode(['files_read']));

        $result = $this->execute($this->context(), $arguments, ToolDefinition::RISK_SAFE);

        $this->assertFalse($result->ok);
        $this->assertSame('forbidden', $result->code);
    }

    public function testLoweringTheLiveBatchLimitAbortsAnApprovedLargerBatch(): void
    {
        config()->set('modules.ai.agent.max_batch_calls', 4);
        [$arguments] = $this->plan($this->reads(3));
        config()->set('modules.ai.agent.max_batch_calls', 2);

        $result = $this->execute($this->context(), $arguments, ToolDefinition::RISK_SAFE);

        $this->assertFalse($result->ok);
        $this->assertSame('batch_policy_changed', $result->code);
    }

    public function testDisablingDestructiveBatchesWhileTheCardIsOpenAbortsExecution(): void
    {
        config()->set('modules.ai.agent.allow_destructive_batches', true);
        [$arguments, $risk] = $this->plan([
            'summary' => 'Remove old worlds',
            'calls' => [
                ['tool' => 'files_delete', 'arguments' => ['root' => '/', 'files' => ['old-a']]],
                ['tool' => 'files_delete', 'arguments' => ['root' => '/', 'files' => ['old-b']]],
            ],
        ]);
        config()->set('modules.ai.agent.allow_destructive_batches', false);

        $result = $this->execute($this->context(), $arguments, $risk);

        $this->assertFalse($result->ok);
        $this->assertSame('batch_policy_changed', $result->code);
    }

    public function testTheWrapperOverrideIsIncludedWhenTheBatchIsPlanned(): void
    {
        Setting::set('settings::modules:ai:risk_overrides', json_encode([
            SharedTools::BATCH => ToolDefinition::RISK_DESTRUCTIVE,
        ]));

        [$arguments, $risk] = $this->plan($this->reads(2));

        $this->assertCount(2, $arguments['calls']);
        $this->assertSame(ToolDefinition::RISK_DESTRUCTIVE, $risk);
    }

    public function testAWrapperRiskIncreaseBeforeDispatchAbortsTheBatch(): void
    {
        [$arguments, $risk] = $this->plan($this->reads(2));
        Setting::set('settings::modules:ai:risk_overrides', json_encode([
            SharedTools::BATCH => ToolDefinition::RISK_DESTRUCTIVE,
        ]));

        $result = $this->execute($this->context(), $arguments, $risk);

        $this->assertFalse($result->ok);
        $this->assertSame('risk_changed', $result->code);
    }

    public function testAnExpiredSharedDeadlinePreventsEveryBatchChildFromStarting(): void
    {
        [$arguments] = $this->plan($this->reads(2));
        $context = $this->context();
        $context->deadline = microtime(true) - 1;

        $result = $this->execute($context, $arguments, ToolDefinition::RISK_SAFE);

        $this->assertFalse($result->ok);
        $this->assertSame(ToolResult::OUTCOME_FAILED, $result->outcome);
        $this->assertSame(0, $result->data['succeeded']);
        $this->assertSame(2, $result->data['not_run']);
        $this->assertSame('out_of_time', $result->data['calls'][0]['not_run']);
    }

    /*
    |--------------------------------------------------------------------------
    | What the user is shown
    |--------------------------------------------------------------------------
    */

    /**
     * The single most important preview of the three. A batch's arguments *are*
     * tool calls, so rendered as arguments they come out as nested JSON — and a
     * wall of JSON is the card nobody reads, which hands back exactly the review
     * quality that approving once instead of twenty times was meant to keep.
     */
    public function testThePreviewListsTheCallsRatherThanNestingThem(): void
    {
        [$arguments] = $this->plan($this->reads(3));

        $preview = ApprovalPreview::for(SharedTools::BATCH, $arguments);

        $this->assertSame('batch', $preview['kind']);
        $this->assertSame(3, $preview['count']);
        $this->assertCount(3, $preview['calls']);
        $this->assertSame('files_read', $preview['calls'][0]['tool']);
        $this->assertSame('Read the config files', $preview['summary']);
    }

    public function testAnEmptyBatchHasNoPreviewToDraw(): void
    {
        $this->assertNull(ApprovalPreview::for(SharedTools::BATCH, ['calls' => []]));
    }

    /**
     * AI-041. Every child carries the tier that decides whether it must be read.
     *
     * The preview's own docblock claimed the tier travelled "because the card
     * colours rows by it". It did not travel at all, so the card had nothing to
     * distinguish a read from a write with, and no basis on which to insist the
     * writes be opened before the set could be approved.
     */
    public function testEveryPreviewedChildCarriesItsLiveRiskAndTheReviewCount(): void
    {
        [$arguments] = $this->plan([
            'summary' => 'Read one file and rewrite a variable',
            'calls' => [
                ['tool' => 'files_read', 'arguments' => ['file' => 'server.properties']],
                ['tool' => 'startup_set', 'arguments' => ['key' => 'MAX_PLAYERS', 'value' => '40']],
                ['tool' => 'files_read', 'arguments' => ['file' => 'ops.json']],
            ],
        ]);

        $preview = ApprovalPreview::for(SharedTools::BATCH, $arguments);

        $this->assertSame(ToolDefinition::RISK_SAFE, $preview['calls'][0]['risk']);
        $this->assertSame(ToolDefinition::RISK_WRITE, $preview['calls'][1]['risk']);
        $this->assertSame(ToolDefinition::RISK_SAFE, $preview['calls'][2]['risk']);

        // Only the write has to be read. Demanding ceremony for the reads would
        // train people to click through the one that matters.
        $this->assertSame(1, $preview['requires_review']);
    }

    /**
     * The tier is resolved when the card is drawn, not when the batch was
     * planned — a preview is rebuilt from stored arguments when the user comes
     * back to it, and an operator may have hardened a tool in between.
     */
    public function testTheReviewBarRisesWithALiveRiskOverride(): void
    {
        [$arguments] = $this->plan($this->reads(3));

        $this->assertSame(0, ApprovalPreview::for(SharedTools::BATCH, $arguments)['requires_review']);

        Setting::set('settings::modules:ai:risk_overrides', json_encode(['files_read' => 'write']));

        $hardened = ApprovalPreview::for(SharedTools::BATCH, $arguments);

        $this->assertSame(3, $hardened['requires_review']);
        $this->assertSame(ToolDefinition::RISK_WRITE, $hardened['calls'][0]['risk']);
    }

    /**
     * A child naming a tool that no longer resolves is previewed at the tier
     * that demands a look, not at the tier that waves it through.
     */
    public function testAnUnresolvableChildIsNeverPreviewedAsSafe(): void
    {
        $preview = ApprovalPreview::for(SharedTools::BATCH, [
            'summary' => 'Something the registry no longer has',
            'calls' => [
                ['tool' => 'files_read', 'arguments' => ['file' => 'a']],
                ['tool' => 'tool_that_was_removed', 'arguments' => []],
            ],
        ]);

        $this->assertSame(ToolDefinition::RISK_DESTRUCTIVE, $preview['calls'][1]['risk']);
        $this->assertSame(1, $preview['requires_review']);
    }

    /**
     * "Done" over a batch that half ran is the most misleading thing the summary
     * could say, and it is the only line the stored transcript keeps.
     */
    public function testTheSummaryReportsTheTally(): void
    {
        $whole = ToolResult::batch(['batch' => true, 'succeeded' => 20, 'failed' => 0, 'not_run' => 0]);
        $partial = ToolResult::batch(['batch' => true, 'succeeded' => 17, 'failed' => 1, 'not_run' => 2]);

        $this->assertSame('20 of 20 done', $whole->summary());
        $this->assertSame('17 of 20 done; 1 failed, 2 not run', $partial->summary());
        $this->assertTrue($whole->ok);
        $this->assertFalse($partial->ok);
        $this->assertSame(ToolResult::OUTCOME_PARTIAL, $partial->outcome);
        $this->assertSame('partial', json_decode($partial->toModelPayload(), true)['status']);
    }

    public function testPartialBatchLedgerSurvivesWireAndStoredTranscriptPayloads(): void
    {
        $result = ToolResult::batch([
            'batch' => true,
            'succeeded' => 1,
            'failed' => 1,
            'not_run' => 1,
            'calls' => [
                ['tool' => 'files_read', 'ok' => true],
                ['tool' => 'files_read', 'ok' => false],
                ['tool' => 'files_read', 'not_run' => 'earlier_failure'],
            ],
        ]);

        $event = AgentEvent::toolResult(
            'batch-1',
            'batch',
            $result->ok,
            $result->summary(),
            $result->data,
            10,
            $result->outcome,
        )->toArray();
        $stored = json_decode(TurnRecorder::toolDisplay(
            $result->ok,
            $result->summary(),
            $result->outcome,
            $result->data,
        ), true);

        $this->assertFalse($event['ok']);
        $this->assertSame('partial', $event['outcome']);
        $this->assertCount(3, $event['result']['calls']);
        $this->assertFalse($stored['ok']);
        $this->assertSame('partial', $stored['outcome']);
        $this->assertCount(3, $stored['result']['calls']);
    }
}
