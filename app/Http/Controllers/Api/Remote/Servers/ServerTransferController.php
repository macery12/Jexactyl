<?php

namespace Everest\Http\Controllers\Api\Remote\Servers;

use Everest\Models\Server;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Everest\Models\Allocation;
use Illuminate\Http\JsonResponse;
use Everest\Models\ServerTransfer;
use Illuminate\Support\Facades\Log;
use Everest\Http\Controllers\Controller;
use Illuminate\Database\ConnectionInterface;
use Everest\Repositories\Eloquent\ServerRepository;
use Everest\Repositories\Wings\DaemonServerRepository;
use Everest\Services\Servers\DaemonServerAuthorizationService;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

class ServerTransferController extends Controller
{
    /**
     * ServerTransferController constructor.
     */
    public function __construct(
        private ConnectionInterface $connection,
        private ServerRepository $repository,
        private DaemonServerRepository $daemonServerRepository,
        private DaemonServerAuthorizationService $authorization,
    ) {
    }

    /**
     * The daemon notifies us about a transfer failure.
     *
     * @throws \Throwable
     */
    public function failure(Request $request, string $uuid): JsonResponse
    {
        $node = $this->authorization->node($request);

        $this->connection->transaction(function () use ($node, $uuid) {
            [$server, $transfer] = $this->getLockedTransfer($uuid);

            if (is_null($transfer)) {
                // Do not expose the state of another node's server when there is
                // no active transfer from which to derive participant access.
                $this->authorization->assertCurrentNode($node, $server);
                throw new ConflictHttpException('Server is not being transferred.');
            }

            $this->authorization->assertCanFailTransfer($node, $transfer);

            $transfer->forceFill(['successful' => false])->saveOrFail();

            $allocations = array_merge([$transfer->new_allocation], (array) $transfer->new_additional_allocations);
            Allocation::query()->whereIn('id', $allocations)->update(['server_id' => null]);
        });

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * The daemon notifies us about a transfer success.
     *
     * @throws \Throwable
     */
    public function success(Request $request, string $uuid): JsonResponse
    {
        $node = $this->authorization->node($request);

        /** @var array{Server, ServerTransfer} $result */
        $result = $this->connection->transaction(function () use ($node, $uuid) {
            [$server, $transfer] = $this->getLockedTransfer($uuid);

            if (is_null($transfer)) {
                $this->authorization->assertCurrentNode($node, $server);
                throw new ConflictHttpException('Server is not being transferred.');
            }

            $this->authorization->assertCanCompleteTransfer($node, $transfer);

            $allocations = array_merge([$transfer->old_allocation], (array) $transfer->old_additional_allocations);

            // Remove the old allocations for the server and re-assign the server to the new
            // primary allocation and node.
            Allocation::query()->whereIn('id', $allocations)->update(['server_id' => null]);

            // Assign the new allocations to the server
            $newAllocations = array_merge([$transfer->new_allocation], (array) $transfer->new_additional_allocations);
            Allocation::query()->whereIn('id', $newAllocations)->update(['server_id' => $server->id]);

            $server->update([
                'allocation_id' => $transfer->new_allocation,
                'node_id' => $transfer->new_node,
            ]);

            $transfer->forceFill(['successful' => true])->saveOrFail();
            $transfer->load('oldNode');

            return [$server->fresh(), $transfer];
        });
        [$server, $transfer] = $result;

        // Delete the server from the old node making sure to point it to the old node so
        // that we do not delete it from the new node the server was transferred to.
        try {
            $this->daemonServerRepository
                ->setServer($server)
                ->setNode($transfer->oldNode)
                ->delete();
        } catch (DaemonConnectionException $exception) {
            Log::warning($exception, ['transfer_id' => $transfer->id]);
        }

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Lock and re-read the server and its active transfer so that authorization
     * and terminal state changes are made against one serialized snapshot.
     *
     * @return array{Server, ServerTransfer|null}
     */
    private function getLockedTransfer(string $uuid): array
    {
        $resolved = $this->repository->getByUuid($uuid);

        /** @var Server $server */
        $server = Server::query()->whereKey($resolved->id)->lockForUpdate()->firstOrFail();

        /** @var ServerTransfer|null $transfer */
        $transfer = ServerTransfer::query()
            ->where('server_id', $server->id)
            ->whereNull('successful')
            ->latest('id')
            ->lockForUpdate()
            ->first();

        return [$server, $transfer];
    }
}
