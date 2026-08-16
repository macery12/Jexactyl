<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\AiPendingAction;
use Everest\Tests\TestCase;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Everest\Http\Controllers\Api\Concerns\HandlesAgentTurns;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolRegistry;

class PendingActionClaimTest extends TestCase
{
    private PendingClaimHarness $harness;

    public function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('ai_pending_actions')) {
            Schema::create('ai_pending_actions', function (Blueprint $table): void {
                $table->id();
                $table->uuid('turn_id')->unique();
                $table->unsignedBigInteger('conversation_id')->nullable();
                $table->unsignedInteger('user_id');
                $table->char('server_uuid', 36)->nullable();
                $table->string('scope', 16)->nullable();
                $table->string('tool_name', 64);
                $table->string('tool_call_id')->nullable();
                $table->string('risk', 16);
                $table->json('arguments');
                $table->json('state');
                $table->unsignedSmallInteger('step')->default(0);
                $table->string('status', 16)->default('pending');
                $table->uuid('execution_key')->nullable()->unique();
                $table->timestamp('claimed_at')->nullable();
                $table->timestamp('resolved_at')->nullable();
                $table->string('failure_reason')->nullable();
                $table->timestamp('expires_at');
                $table->timestamps();
            });
        }

        AiPendingAction::query()->delete();
        $this->harness = new PendingClaimHarness();
    }

    public function testExactlyOneOfTwoClaimantsCanReserveTheMutation(): void
    {
        $row = $this->pending();
        $first = AiPendingAction::findOrFail($row->id);
        $second = AiPendingAction::findOrFail($row->id);

        $this->assertTrue($this->harness->claim($first));
        $this->assertFalse($this->harness->claim($second));

        $row->refresh();
        $this->assertSame(AiPendingAction::STATUS_EXECUTING, $row->status);
        $this->assertNotNull($row->execution_key);
        $this->assertSame($row->execution_key, $second->execution_key);
    }

    public function testDuplicateBatchApprovalCannotAcquireASecondExecutionKey(): void
    {
        $row = $this->pending(['tool_name' => 'batch']);

        $this->assertTrue($this->harness->claim(AiPendingAction::findOrFail($row->id)));
        $key = $row->fresh()->execution_key;
        $this->assertFalse($this->harness->claim(AiPendingAction::findOrFail($row->id)));
        $this->assertSame($key, $row->fresh()->execution_key);
    }

    public function testClaimedWorkerFailureBecomesTerminalAndIsNeverReclaimed(): void
    {
        $row = $this->pending();
        $this->assertTrue($this->harness->claim($row));

        $row->update(['claimed_at' => now()->subMinutes(11)]);
        $this->harness->recover($row->fresh());

        $row->refresh();
        $this->assertSame(AiPendingAction::STATUS_FAILED, $row->status);
        $this->assertNotNull($row->resolved_at);
        $this->assertFalse($this->harness->claim($row));
    }

    public function testExecutionKeysAreStablePerCallAndDistinctAcrossBatchChildren(): void
    {
        $context = new \Everest\Services\AI\Agent\AgentContext(
            new \Everest\Models\User(),
            null,
            'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        );
        $context->executionKey = '11111111-2222-4333-8444-555555555555';

        $this->assertSame($context->idempotencyKeyFor('child-1'), $context->idempotencyKeyFor('child-1'));
        $this->assertNotSame($context->idempotencyKeyFor('child-1'), $context->idempotencyKeyFor('child-2'));
    }

    private function pending(array $overrides = []): AiPendingAction
    {
        return AiPendingAction::create(array_merge([
            'turn_id' => 'aaaaaaaa-bbbb-4ccc-8ddd-' . str_pad((string) (AiPendingAction::count() + 1), 12, '0', STR_PAD_LEFT),
            'conversation_id' => null,
            'user_id' => 1,
            'server_uuid' => null,
            'scope' => 'admin',
            'tool_name' => 'admin_product_create',
            'tool_call_id' => 'call-1',
            'risk' => 'write',
            'arguments' => [],
            'state' => [],
            'step' => 1,
            'status' => AiPendingAction::STATUS_PENDING,
            'expires_at' => now()->addMinutes(30),
        ], $overrides));
    }
}

class PendingClaimHarness
{
    use HandlesAgentTurns;

    public function claim(AiPendingAction $pending): bool
    {
        return $this->claimPending($pending);
    }

    public function recover(AiPendingAction $pending): void
    {
        $this->recoverStaleClaim($pending);
    }

    protected function agentRunner(): AgentRunner { throw new \LogicException(); }
    protected function toolRegistry(): ToolRegistry { throw new \LogicException(); }
    protected function toolRiskGate(): RiskGate { throw new \LogicException(); }
    protected function turnRecorder(): TurnRecorder { throw new \LogicException(); }
    protected function providerFactory(): ProviderFactory { throw new \LogicException(); }
}
