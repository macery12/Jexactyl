<?php

namespace Everest\Tests\Integration\Api\Remote;

use Everest\Models\Node;
use Everest\Models\Backup;
use Everest\Models\Server;
use Everest\Models\Allocation;
use Everest\Models\ServerTransfer;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Repositories\Wings\DaemonServerRepository;

class DaemonResourceAuthorizationTest extends IntegrationTestCase
{
    #[DataProvider('foreignTransferRouteProvider')]
    public function testForeignNodeCannotMutateTransferCallbacks(string $method, string $callback): void
    {
        $server = $this->createServerModel();
        $target = Node::factory()->create();
        $foreign = Node::factory()->create();
        $transfer = $this->createTransfer($server, $target);

        $this->authorizeNode($foreign);
        $this->json($method, "/api/remote/servers/{$server->uuid}/transfer/{$callback}")
            ->assertForbidden();

        $this->assertNull($transfer->fresh()->successful);
        $this->assertSame($server->node_id, $server->fresh()->node_id);
    }

    public static function foreignTransferRouteProvider(): array
    {
        return [
            'GET failure' => ['GET', 'failure'],
            'POST failure' => ['POST', 'failure'],
            'GET success' => ['GET', 'success'],
            'POST success' => ['POST', 'success'],
        ];
    }

    #[DataProvider('failureParticipantProvider')]
    public function testTransferFailureCanBeReportedByEitherParticipant(string $participant, string $method): void
    {
        $server = $this->createServerModel();
        $target = Node::factory()->create();
        $transfer = $this->createTransfer($server, $target);

        $this->authorizeNode($participant === 'source' ? $server->node : $target);
        $this->json($method, "/api/remote/servers/{$server->uuid}/transfer/failure")
            ->assertNoContent();

        $this->assertFalse($transfer->fresh()->successful);
        $this->assertDatabaseHas('allocations', [
            'id' => $transfer->new_allocation,
            'server_id' => null,
        ]);
    }

    public static function failureParticipantProvider(): array
    {
        return [
            'source using legacy GET' => ['source', 'GET'],
            'target using POST' => ['target', 'POST'],
        ];
    }

    #[DataProvider('httpMethodProvider')]
    public function testOnlyTargetNodeCanCompleteTransfer(string $method): void
    {
        $server = $this->createServerModel();
        $target = Node::factory()->create();
        $transfer = $this->createTransfer($server, $target);

        $this->instance(DaemonServerRepository::class, $daemon = \Mockery::mock(DaemonServerRepository::class));
        $daemon->expects('setServer')
            ->once()
            ->with(\Mockery::on(fn (Server $value) => $value->id === $server->id))
            ->andReturnSelf();
        $daemon->expects('setNode')
            ->once()
            ->with(\Mockery::on(fn (Node $value) => $value->id === $server->node_id))
            ->andReturnSelf();
        $daemon->expects('delete')->once();

        $this->authorizeNode($server->node);
        $this->json($method, "/api/remote/servers/{$server->uuid}/transfer/success")
            ->assertForbidden();

        $this->authorizeNode($target);
        $this->json($method, "/api/remote/servers/{$server->uuid}/transfer/success")
            ->assertNoContent();

        $this->assertTrue($transfer->fresh()->successful);
        $this->assertSame($target->id, $server->fresh()->node_id);
        $this->assertDatabaseHas('allocations', [
            'id' => $transfer->old_allocation,
            'server_id' => null,
        ]);
        $this->assertDatabaseHas('allocations', [
            'id' => $transfer->new_allocation,
            'server_id' => $server->id,
        ]);
    }

    public static function httpMethodProvider(): array
    {
        return [
            'legacy GET' => ['GET'],
            'POST' => ['POST'],
        ];
    }

    public function testServerDetailsAndInstallUseTheirExplicitNodeMatrices(): void
    {
        $server = $this->createServerModel();
        $target = Node::factory()->create();
        $this->createTransfer($server, $target);

        $this->authorizeNode($server->node);
        $this->getJson("/api/remote/servers/{$server->uuid}")->assertOk();
        $this->getJson("/api/remote/servers/{$server->uuid}/install")->assertOk();
        $this->postJson("/api/remote/servers/{$server->uuid}/install", [
            'successful' => true,
        ])->assertNoContent();

        $this->authorizeNode($target);
        $this->getJson("/api/remote/servers/{$server->uuid}")->assertOk();
        $this->getJson("/api/remote/servers/{$server->uuid}/install")->assertForbidden();
        $this->postJson("/api/remote/servers/{$server->uuid}/install", [
            'successful' => true,
        ])->assertForbidden();

        $foreign = Node::factory()->create();
        $this->authorizeNode($foreign);
        $this->getJson("/api/remote/servers/{$server->uuid}")->assertForbidden();
    }

    public function testBackupCallbacksAreLimitedToBackupsOnTheRequestingNode(): void
    {
        $server = $this->createServerModel(['status' => Server::STATUS_RESTORING_BACKUP]);
        $backup = Backup::factory()->create([
            'server_id' => $server->id,
            'is_successful' => false,
            'completed_at' => null,
        ]);

        $this->authorizeNode(Node::factory()->create());

        $this->getJson("/api/remote/backups/{$backup->uuid}?size=-1")->assertForbidden();
        $this->postJson("/api/remote/backups/{$backup->uuid}", [
            'successful' => false,
        ])->assertForbidden();
        $this->postJson("/api/remote/backups/{$backup->uuid}/restore", [
            'successful' => false,
        ])->assertForbidden();

        $this->assertFalse($backup->fresh()->is_successful);
        $this->assertNull($backup->fresh()->completed_at);
        $this->assertSame(Server::STATUS_RESTORING_BACKUP, $server->fresh()->status);
    }

    public function testBackupCallbacksRemainAvailableToTheOwningNode(): void
    {
        $server = $this->createServerModel(['status' => Server::STATUS_RESTORING_BACKUP]);
        $backup = Backup::factory()->create([
            'server_id' => $server->id,
            'is_successful' => false,
            'completed_at' => null,
            'ignored_files' => [],
        ]);

        $this->authorizeNode($server->node);
        $this->postJson("/api/remote/backups/{$backup->uuid}", [
            'successful' => false,
            'checksum' => '',
            'checksum_type' => '',
            'size' => 0,
            'parts' => null,
        ])->assertNoContent();
        $this->postJson("/api/remote/backups/{$backup->uuid}/restore", [
            'successful' => false,
        ])->assertNoContent();

        $this->assertNotNull($backup->fresh()->completed_at);
        $this->assertNull($server->fresh()->status);
    }

    private function authorizeNode(Node $node): void
    {
        $this->withHeader('Authorization', 'Bearer ' . $node->daemon_token_id . '.' . decrypt($node->daemon_token));
    }

    private function createTransfer(Server $server, Node $target): ServerTransfer
    {
        $targetAllocation = Allocation::factory()->create([
            'node_id' => $target->id,
            'server_id' => $server->id,
        ]);

        return ServerTransfer::query()->create([
            'server_id' => $server->id,
            'old_node' => $server->node_id,
            'new_node' => $target->id,
            'old_allocation' => $server->allocation_id,
            'new_allocation' => $targetAllocation->id,
            'old_additional_allocations' => [],
            'new_additional_allocations' => [],
        ]);
    }
}
