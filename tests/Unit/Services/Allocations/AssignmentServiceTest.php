<?php

namespace Everest\Tests\Unit\Services\Allocations;

use Everest\Models\Node;
use Everest\Tests\TestCase;
use Illuminate\Database\ConnectionInterface;
use Everest\Services\Allocations\AssignmentService;
use Everest\Contracts\Repository\AllocationRepositoryInterface;

class AssignmentServiceTest extends TestCase
{
    public function testRepositoryFailureAlwaysBalancesTheTransaction(): void
    {
        $connection = $this->app->make(ConnectionInterface::class);
        $repository = \Mockery::mock(AllocationRepositoryInterface::class);
        $repository->shouldReceive('insertIgnore')
            ->once()
            ->andThrow(new \RuntimeException('injected insert failure'));

        $node = new Node();
        $node->id = 1;
        $service = new AssignmentService($repository, $connection);

        try {
            $service->handle($node, [
                'ip' => '127.0.0.1',
                'allocation_ports' => [5000],
            ]);
            $this->fail('The injected repository error should escape.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('injected insert failure', $exception->getMessage());
            $this->assertSame(0, $connection->transactionLevel());
        }
    }
}
