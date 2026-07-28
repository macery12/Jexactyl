<?php

namespace Everest\Tests\Integration\Api\Remote;

use Everest\Models\Node;
use Everest\Models\User;
use Everest\Models\Subuser;
use Everest\Models\ActivityLog;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Http\Requests\Api\Remote\ActivityEventRequest;

class RemoteActivitySecurityTest extends IntegrationTestCase
{
    public function testActorsAreResolvedOnlyThroughTheAuthenticatedNodesServer(): void
    {
        $server = $this->createServerModel();
        $subuser = User::factory()->create();
        $foreign = User::factory()->create();
        Subuser::query()->create([
            'server_id' => $server->id,
            'user_id' => $subuser->id,
            'permissions' => [],
        ]);

        $this->authorizeNode($server->node);
        $this->postJson('/api/remote/activity', [
            'data' => [
                $this->event($server->uuid, 'server:test.owner', $server->user->uuid),
                $this->event($server->uuid, 'server:test.subuser', $subuser->uuid),
                $this->event($server->uuid, 'server:test.foreign', $foreign->uuid),
            ],
        ])->assertOk();

        $this->assertSame(
            $server->owner_id,
            ActivityLog::query()
                ->where('server_id', $server->id)
                ->where('event', 'server:test.owner')
                ->value('actor_id')
        );
        $this->assertSame(
            $subuser->id,
            ActivityLog::query()
                ->where('server_id', $server->id)
                ->where('event', 'server:test.subuser')
                ->value('actor_id')
        );
        $this->assertNull(
            ActivityLog::query()
                ->where('server_id', $server->id)
                ->where('event', 'server:test.foreign')
                ->value('actor_id')
        );
    }

    public function testActivityRateLimitIsKeyedToTheAuthenticatedNode(): void
    {
        config()->set('http.rate_limit.daemon_activity', 2);
        config()->set('http.rate_limit.daemon_activity_period', 1);

        $first = $this->createServerModel();
        $second = $this->createServerModel();
        $payload = ['data' => [$this->event($first->uuid, 'server:test.rate')]];

        $this->authorizeNode($first->node);
        $this->postJson('/api/remote/activity', $payload)->assertOk();
        $this->postJson('/api/remote/activity', $payload)->assertOk();
        $this->postJson('/api/remote/activity', $payload)->assertTooManyRequests();

        // A noisy node cannot consume another node's independent allowance.
        $this->authorizeNode($second->node);
        $this->postJson('/api/remote/activity', [
            'data' => [$this->event($second->uuid, 'server:test.rate')],
        ])->assertOk();
    }

    public function testOversizedPerEventMetadataIsRejected(): void
    {
        $server = $this->createServerModel();
        $this->authorizeNode($server->node);

        $this->postJson('/api/remote/activity', [
            'data' => [
                $this->event($server->uuid, 'server:test.metadata', null, [
                    'value' => str_repeat('x', ActivityEventRequest::MAX_METADATA_BYTES),
                ]),
            ],
        ])->assertUnprocessable()
            ->assertJsonPath('errors.0.meta.source_field', 'data.0.metadata');

        $this->assertDatabaseMissing('activity_logs', ['event' => 'server:test.metadata']);
    }

    private function authorizeNode(Node $node): void
    {
        $this->withHeader('Authorization', 'Bearer ' . $node->daemon_token_id . '.' . decrypt($node->daemon_token));
    }

    private function event(string $server, string $event, ?string $user = null, array $metadata = []): array
    {
        return [
            'server' => $server,
            'user' => $user,
            'event' => $event,
            'metadata' => $metadata,
            'ip' => '192.0.2.10',
            'timestamp' => '2026-07-28T00:00:00Z',
        ];
    }
}
