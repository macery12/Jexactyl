<?php

namespace Everest\Services\Allocations;

use Everest\Models\Node;
use Everest\Models\Server;
use Webmozart\Assert\Assert;
use Everest\Models\Allocation;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\ConnectionInterface;
use Everest\Exceptions\Service\Allocation\AutoAllocationNotEnabledException;
use Everest\Exceptions\Service\Allocation\NoAutoAllocationSpaceAvailableException;

class FindAssignableAllocationService
{
    /**
     * FindAssignableAllocationService constructor.
     */
    public function __construct(
        private AssignmentService $service,
        private ConnectionInterface $connection,
    ) {
    }

    /**
     * Finds an existing unassigned allocation and attempts to assign it to the given server. If
     * no allocation can be found, a new one will be created with a random port between the defined
     * range from the configuration.
     *
     * @throws DisplayException
     * @throws \Everest\Exceptions\Service\Allocation\CidrOutOfRangeException
     * @throws \Everest\Exceptions\Service\Allocation\InvalidPortMappingException
     * @throws \Everest\Exceptions\Service\Allocation\PortOutOfRangeException
     * @throws \Everest\Exceptions\Service\Allocation\TooManyPortsInRangeException
     */
    public function handle(Server $server): Allocation
    {
        if (!config('everest.client_features.allocations.enabled')) {
            throw new AutoAllocationNotEnabledException();
        }

        return $this->connection->transaction(function () use ($server): Allocation {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()
                ->with(['node', 'allocation'])
                ->whereKey($server->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($lockedServer->allocations()->count() >= $lockedServer->allocation_limit) {
                throw new DisplayException('Cannot assign additional allocations to this server: limit has been reached.');
            }

            // Dynamic port creation is a node-wide namespace. Serializing only
            // on the destination server allows two different servers to choose
            // the same missing port and race through insert-ignore.
            /** @var Node $lockedNode */
            $lockedNode = Node::query()
                ->whereKey($lockedServer->node_id)
                ->lockForUpdate()
                ->firstOrFail();

            // Lock the selected free row as well as the server quota row so two
            // requests cannot claim the same allocation.
            /** @var Allocation|null $allocation */
            $allocation = $lockedNode->allocations()
                ->where('ip', $lockedServer->allocation->ip)
                ->whereNull('server_id')
                ->inRandomOrder()
                ->lockForUpdate()
                ->first();

            $allocation = $allocation ?? $this->createNewAllocation($lockedServer, $lockedNode);
            $assigned = Allocation::query()
                ->whereKey($allocation->id)
                ->whereNull('server_id')
                ->update(['server_id' => $lockedServer->id]);
            if ($assigned !== 1) {
                throw new NoAutoAllocationSpaceAvailableException();
            }

            return $allocation->refresh();
        });
    }

    /**
     * Create a new allocation on the server's node with a random port from the defined range
     * in the settings. If there are no matches in that range, or something is wrong with the
     * range information provided an exception will be raised.
     *
     * @throws DisplayException
     * @throws \Everest\Exceptions\Service\Allocation\CidrOutOfRangeException
     * @throws \Everest\Exceptions\Service\Allocation\InvalidPortMappingException
     * @throws \Everest\Exceptions\Service\Allocation\PortOutOfRangeException
     * @throws \Everest\Exceptions\Service\Allocation\TooManyPortsInRangeException
     */
    protected function createNewAllocation(Server $server, Node $node): Allocation
    {
        $start = config('everest.client_features.allocations.range_start', null);
        $end = config('everest.client_features.allocations.range_end', null);

        if (!$start || !$end) {
            throw new NoAutoAllocationSpaceAvailableException();
        }

        Assert::integerish($start);
        Assert::integerish($end);

        // Get all of the currently allocated ports for the node so that we can figure out
        // which port might be available.
        $ports = $node->allocations()
            ->where('ip', $server->allocation->ip)
            ->whereBetween('port', [$start, $end])
            ->pluck('port');

        // Compute the difference of the range and the currently created ports, finding
        // any port that does not already exist in the database. We will then use this
        // array of ports to create a new allocation to assign to the server.
        $available = array_diff(range($start, $end), $ports->toArray());

        // If we've already allocated all of the ports, just abort.
        if (empty($available)) {
            throw new NoAutoAllocationSpaceAvailableException();
        }

        // Try candidates in random order. AssignmentService deliberately uses
        // insert-ignore; if an out-of-band creator won a unique-key race, only
        // accept the row when it is still unassigned and locked by us.
        shuffle($available);
        foreach ($available as $port) {
            $this->service->handle($node, [
                'ip' => $server->allocation->ip,
                'allocation_ports' => [$port],
            ]);

            /** @var Allocation|null $allocation */
            $allocation = $node->allocations()
                ->where('ip', $server->allocation->ip)
                ->where('port', $port)
                ->whereNull('server_id')
                ->lockForUpdate()
                ->first();
            if ($allocation !== null) {
                return $allocation;
            }
        }

        throw new NoAutoAllocationSpaceAvailableException();
    }
}
