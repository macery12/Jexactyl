<?php

namespace Everest\Tests\Unit\Console\Commands\AI;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\AiToolCall;
use Everest\Models\AiUsageLog;
use Everest\Models\AiTurnEvent;
use Everest\Models\AiConversation;
use Illuminate\Support\Facades\DB;
use Everest\Models\AiPendingAction;
use Everest\Models\AiToolDiscovery;
use Illuminate\Foundation\Testing\RefreshDatabase;

class PruneAiConversationsCommandTest extends TestCase
{
    use RefreshDatabase;

    public function testItPrunesEachRetentionTableWithoutDeletingLiveState(): void
    {
        config()->set('modules.ai.retention', [
            'turn_events_days' => 2,
            'tool_discovery_days' => 14,
            'tool_calls_days' => 90,
            'usage_logs_days' => 180,
            'pending_actions_days' => 30,
            'turn_events_limit' => 20,
            'tool_discovery_limit' => 20,
            'tool_calls_limit' => 20,
            'usage_logs_limit' => 20,
            'pending_actions_limit' => 20,
        ]);

        $user = User::factory()->create();
        $conversation = AiConversation::create([
            'user_id' => $user->id,
            'server_uuid' => null,
            'scope' => AiConversation::SCOPE_ADMIN,
            'title' => 'Retention test',
            'is_saved' => true,
        ]);

        $oldEvent = AiTurnEvent::create($this->event('aaaaaaaa-bbbb-4ccc-8ddd-000000000001'));
        $newEvent = AiTurnEvent::create($this->event('aaaaaaaa-bbbb-4ccc-8ddd-000000000002'));
        $this->age('ai_turn_events', $oldEvent->id, 'created_at', 3);

        $oldDiscovery = AiToolDiscovery::create($this->discovery('aaaaaaaa-bbbb-4ccc-8ddd-000000000003'));
        $newDiscovery = AiToolDiscovery::create($this->discovery('aaaaaaaa-bbbb-4ccc-8ddd-000000000004'));
        $this->age('ai_tool_discovery', $oldDiscovery->id, 'created_at', 15);

        $oldCall = AiToolCall::create($this->toolCall('aaaaaaaa-bbbb-4ccc-8ddd-000000000005'));
        $newCall = AiToolCall::create($this->toolCall('aaaaaaaa-bbbb-4ccc-8ddd-000000000006'));
        $this->age('ai_tool_calls', $oldCall->id, 'created_at', 91);

        $oldUsage = AiUsageLog::create($this->usage('aaaaaaaa-bbbb-4ccc-8ddd-000000000007'));
        $newUsage = AiUsageLog::create($this->usage('aaaaaaaa-bbbb-4ccc-8ddd-000000000008'));
        $this->age('ai_usage_logs', $oldUsage->id, 'created_at', 181);

        $terminal = AiPendingAction::create($this->pending(
            $user->id,
            $conversation->id,
            'aaaaaaaa-bbbb-4ccc-8ddd-000000000009',
            AiPendingAction::STATUS_COMPLETED,
        ));
        $live = AiPendingAction::create($this->pending(
            $user->id,
            $conversation->id,
            'aaaaaaaa-bbbb-4ccc-8ddd-000000000010',
            AiPendingAction::STATUS_PENDING,
        ));
        $executing = AiPendingAction::create($this->pending(
            $user->id,
            $conversation->id,
            'aaaaaaaa-bbbb-4ccc-8ddd-000000000011',
            AiPendingAction::STATUS_EXECUTING,
        ));
        foreach ([$terminal, $live, $executing] as $pending) {
            $this->age('ai_pending_actions', $pending->id, 'updated_at', 31);
        }

        $this->artisan('p:ai:prune-conversations')->assertSuccessful();

        $this->assertModelMissing($oldEvent);
        $this->assertModelExists($newEvent);
        $this->assertModelMissing($oldDiscovery);
        $this->assertModelExists($newDiscovery);
        $this->assertModelMissing($oldCall);
        $this->assertModelExists($newCall);
        $this->assertModelMissing($oldUsage);
        $this->assertModelExists($newUsage);
        $this->assertModelMissing($terminal);
        $this->assertModelExists($live);
        $this->assertModelExists($executing);
    }

    /** @return array<string, mixed> */
    private function event(string $turnId): array
    {
        return ['turn_id' => $turnId, 'seq' => 1, 'type' => 'text', 'payload' => []];
    }

    /** @return array<string, mixed> */
    private function discovery(string $turnId): array
    {
        return [
            'turn_id' => $turnId,
            'step' => 1,
            'scope' => 'admin',
            'phase' => 'step',
            'event' => AiToolDiscovery::EVENT_SEARCH,
            'query' => 'server',
        ];
    }

    /** @return array<string, mixed> */
    private function toolCall(string $turnId): array
    {
        return [
            'turn_id' => $turnId,
            'scope' => 'admin',
            'tool_name' => 'admin_servers_list',
            'risk' => 'read',
            'status' => AiToolCall::STATUS_SUCCEEDED,
        ];
    }

    /** @return array<string, mixed> */
    private function usage(string $turnId): array
    {
        return [
            'turn_id' => $turnId,
            'model' => 'test-model',
            'source' => 'admin',
            'status' => 'success',
        ];
    }

    /** @return array<string, mixed> */
    private function pending(int $userId, int $conversationId, string $turnId, string $status): array
    {
        return [
            'turn_id' => $turnId,
            'conversation_id' => $conversationId,
            'user_id' => $userId,
            'server_uuid' => null,
            'scope' => 'admin',
            'tool_name' => 'admin_servers_list',
            'tool_call_id' => 'call-' . substr($turnId, -2),
            'risk' => 'read',
            'arguments' => [],
            'state' => [],
            'status' => $status,
            'expires_at' => now()->addMinutes(30),
        ];
    }

    private function age(string $table, int $id, string $column, int $days): void
    {
        DB::table($table)->where('id', $id)->update([$column => now()->subDays($days)]);
    }
}
