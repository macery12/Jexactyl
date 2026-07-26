<?php

namespace Everest\Tests\Integration\Services\Allocations;

use Everest\Models\Allocation;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\ConnectionInterface;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Services\Allocations\AssignmentService;
use Everest\Services\Allocations\FindAssignableAllocationService;
use Everest\Exceptions\Service\Allocation\AutoAllocationNotEnabledException;
use Everest\Exceptions\Service\Allocation\NoAutoAllocationSpaceAvailableException;

class FindAssignableAllocationServiceTest extends IntegrationTestCase
{
    /**
     * Setup tests.
     */
    public function setUp(): void
    {
        parent::setUp();

        config()->set('everest.client_features.allocations.enabled', true);
        config()->set('everest.client_features.allocations.range_start', 0);
        config()->set('everest.client_features.allocations.range_end', 0);
    }

    /**
     * Test that an unassigned allocation is preferred rather than creating an entirely new
     * allocation for the server.
     */
    public function testExistingAllocationIsPreferred()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);

        $created = Allocation::factory()->create([
            'node_id' => $server->node_id,
            'ip' => $server->allocation->ip,
        ]);

        $response = $this->getService()->handle($server);

        $this->assertSame($created->getKey(), $response->id);
        $this->assertSame($server->allocation->ip, $response->ip);
        $this->assertSame($server->node_id, $response->node_id);
        $this->assertSame($server->id, $response->server_id);
        $this->assertNotSame($server->allocation_id, $response->id);
    }

    public function testQuotaIsRecheckedUsingFreshLockedServerState(): void
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);
        $staleServer = $server->fresh();

        $server->newQuery()->whereKey($server->id)->update(['allocation_limit' => 1]);
        $free = Allocation::factory()->create([
            'node_id' => $server->node_id,
            'ip' => $server->allocation->ip,
        ]);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('limit has been reached');

        try {
            $this->getService()->handle($staleServer);
        } finally {
            $this->assertNull(
                Allocation::query()->findOrFail($free->getKey())->server_id
            );
        }
    }

    /**
     * Test that a new allocation is created if there is not a free one available.
     */
    public function testNewAllocationIsCreatedIfOneIsNotFound()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);
        config()->set('everest.client_features.allocations.range_start', 5000);
        config()->set('everest.client_features.allocations.range_end', 5005);

        $response = $this->getService()->handle($server);
        $this->assertSame($server->id, $response->server_id);
        $this->assertSame($server->allocation->ip, $response->ip);
        $this->assertSame($server->node_id, $response->node_id);
        $this->assertNotSame($server->allocation_id, $response->id);
        $this->assertTrue($response->port >= 5000 && $response->port <= 5005);
    }

    /**
     * Test that a currently assigned port is never assigned to a server.
     */
    public function testOnlyPortNotInUseIsCreated()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);
        $server2 = $this->createServerModel(['node_id' => $server->node_id]);

        config()->set('everest.client_features.allocations.range_start', 5000);
        config()->set('everest.client_features.allocations.range_end', 5001);

        Allocation::factory()->create([
            'server_id' => $server2->id,
            'node_id' => $server->node_id,
            'ip' => $server->allocation->ip,
            'port' => 5000,
        ]);

        $response = $this->getService()->handle($server);
        $this->assertSame(5001, $response->port);
    }

    public function testDynamicPortCollisionNeverStealsTheWinningAllocation(): void
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);
        $winner = $this->createServerModel(['node_id' => $server->node_id]);
        config()->set('everest.client_features.allocations.range_start', 5000);
        config()->set('everest.client_features.allocations.range_end', 5000);

        $assignment = \Mockery::mock(AssignmentService::class);
        $assignment->shouldReceive('handle')
            ->once()
            ->andReturnUsing(function ($node, array $data) use ($server, $winner): void {
                Allocation::factory()->create([
                    'node_id' => $node->id,
                    'ip' => $server->allocation->ip,
                    'port' => $data['allocation_ports'][0],
                    'server_id' => $winner->id,
                ]);
            });

        $service = new class ($assignment, $this->app->make(ConnectionInterface::class)) extends FindAssignableAllocationService {
            public function createForTest(\Everest\Models\Server $server, \Everest\Models\Node $node): Allocation
            {
                return $this->createNewAllocation($server, $node);
            }
        };

        try {
            $service->createForTest($server, $server->node);
            $this->fail('The collision must exhaust the one-port range.');
        } catch (NoAutoAllocationSpaceAvailableException) {
            $this->assertSame(
                $winner->id,
                Allocation::query()
                    ->where('node_id', $server->node_id)
                    ->where('ip', $server->allocation->ip)
                    ->where('port', 5000)
                    ->value('server_id')
            );
        }
    }

    public function testExceptionIsThrownIfNoMoreAllocationsCanBeCreatedInRange()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);
        $server2 = $this->createServerModel(['node_id' => $server->node_id]);
        config()->set('everest.client_features.allocations.range_start', 5000);
        config()->set('everest.client_features.allocations.range_end', 5005);

        for ($i = 5000; $i <= 5005; ++$i) {
            Allocation::factory()->create([
                'ip' => $server->allocation->ip,
                'port' => $i,
                'node_id' => $server->node_id,
                'server_id' => $server2->id,
            ]);
        }

        $this->expectException(NoAutoAllocationSpaceAvailableException::class);
        $this->expectExceptionMessage('Cannot assign additional allocation: no more space available on node.');

        $this->getService()->handle($server);
    }

    /**
     * Test that we only auto-allocate from the current server's IP address space, and not a random
     * IP address available on that node.
     */
    public function testExceptionIsThrownIfOnlyFreePortIsOnADifferentIp()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);

        Allocation::factory()->times(5)->create(['node_id' => $server->node_id]);

        $this->expectException(NoAutoAllocationSpaceAvailableException::class);
        $this->expectExceptionMessage('Cannot assign additional allocation: no more space available on node.');

        $this->getService()->handle($server);
    }

    public function testExceptionIsThrownIfStartOrEndRangeIsNotDefined()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);

        $this->expectException(NoAutoAllocationSpaceAvailableException::class);
        $this->expectExceptionMessage('Cannot assign additional allocation: no more space available on node.');

        $this->getService()->handle($server);
    }

    public function testExceptionIsThrownIfStartOrEndRangeIsNotNumeric()
    {
        $server = $this->createServerModel(['allocation_limit' => 2]);
        config()->set('everest.client_features.allocations.range_start', 'hodor');
        config()->set('everest.client_features.allocations.range_end', 10);

        try {
            $this->getService()->handle($server);
            $this->fail('This assertion should not be reached.');
        } catch (\Exception $exception) {
            $this->assertInstanceOf(\InvalidArgumentException::class, $exception);
            $this->assertSame('Expected an integerish value. Got: string', $exception->getMessage());
        }

        config()->set('everest.client_features.allocations.range_start', 10);
        config()->set('everest.client_features.allocations.range_end', 'hodor');

        try {
            $this->getService()->handle($server);
            $this->fail('This assertion should not be reached.');
        } catch (\Exception $exception) {
            $this->assertInstanceOf(\InvalidArgumentException::class, $exception);
            $this->assertSame('Expected an integerish value. Got: string', $exception->getMessage());
        }
    }

    public function testExceptionIsThrownIfFeatureIsNotEnabled()
    {
        config()->set('everest.client_features.allocations.enabled', false);
        $server = $this->createServerModel();

        $this->expectException(AutoAllocationNotEnabledException::class);

        $this->getService()->handle($server);
    }

    private function getService(): FindAssignableAllocationService
    {
        return $this->app->make(FindAssignableAllocationService::class);
    }
}
