<?php

namespace Everest\Http\Controllers\Api\Application\Nodes;

use Everest\Models\Node;
use Illuminate\Support\Str;
use Illuminate\Http\JsonResponse;
use Everest\Services\Nodes\WingsDetectionService;
use Everest\Repositories\Wings\DaemonWingsRsRepository;
use Everest\Repositories\Wings\DaemonConfigurationRepository;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Nodes\GetNodeInformationRequest;

class NodeInformationController extends ApplicationApiController
{
    /**
     * NodeInformationController constructor.
     */
    public function __construct(
        private DaemonConfigurationRepository $repository,
        private DaemonWingsRsRepository $wingsRsRepository,
        private WingsDetectionService $detectionService,
    ) {
        parent::__construct();
    }

    /**
     * Returns system information from the node.
     *
     * @throws DaemonConnectionException
     */
    public function information(GetNodeInformationRequest $request, Node $node): JsonResponse
    {
        if (!$node->isSupercharged()) {
            $this->detectionService->detect($node);
            $node->refresh();
        }

        $data = $this->repository->setNode($node)->getSystemInformation();

        $isSupercharged = $node->isSupercharged() || !empty($data['supercharged']);

        return new JsonResponse([
            'version' => $data['version'] ?? null,
            'system' => [
                'type' => Str::title($data['os'] ?? 'Unknown'),
                'arch' => $data['architecture'] ?? null,
                'release' => $data['kernel_version'] ?? null,
                'cpus' => $data['cpu_count'] ?? null,
                'supercharged' => $isSupercharged,
            ],
        ]);
    }

    /**
     * Returns system utilization from the node.
     *
     * @throws DaemonConnectionException
     */
    public function utilization(GetNodeInformationRequest $request, Node $node): JsonResponse
    {
        // Wings-RS does not implement /api/system/utilization; it serves the same figures
        // from /api/system/stats instead. Prefer whichever matches the detected node type,
        // and fall back to the other on a 404 so a stale wings_type still renders.
        if ($node->isSupercharged()) {
            try {
                return new JsonResponse($this->wingsRsStats($node));
            } catch (DaemonConnectionException $exception) {
                if ($exception->getStatusCode() !== 404) {
                    throw $exception;
                }
            }

            return new JsonResponse($this->classicUtilization($node));
        }

        try {
            return new JsonResponse($this->classicUtilization($node));
        } catch (DaemonConnectionException $exception) {
            if ($exception->getStatusCode() !== 404) {
                throw $exception;
            }

            // A 404 here usually means wings_type is stale and this is really a Wings-RS
            // node. Re-detect before retrying, since getSystemStats() refuses to run
            // against a node that isn't flagged supercharged.
            $this->detectionService->detect($node);
            $node->refresh();

            if (!$node->isSupercharged()) {
                throw $exception;
            }
        }

        return new JsonResponse($this->wingsRsStats($node));
    }

    /**
     * Utilization figures from a classic (Go) wings daemon.
     *
     * @throws DaemonConnectionException
     */
    private function classicUtilization(Node $node): array
    {
        $data = $this->repository->setNode($node)->getSystemUtilization();

        return [
            'cpu' => $data['cpu'] ?? 0,
            'memory' => [
                'total' => $data['memory_total'] ?? 0,
                'used' => $data['memory_used'] ?? 0,
            ],
            'swap' => [
                'total' => $data['swap_total'] ?? 0,
                'used' => $data['swap_used'] ?? 0,
            ],
            'disk' => [
                'total' => $data['disk_total'] ?? 0,
                'used' => $data['disk_used'] ?? 0,
            ],
        ];
    }

    /**
     * The same figures pulled from Wings-RS, which nests them one level deeper and
     * reports no swap. Accepts both the nested and flat spellings for safety.
     *
     * @throws DaemonConnectionException
     */
    private function wingsRsStats(Node $node): array
    {
        $response = $this->wingsRsRepository->setNode($node)->getSystemStats();
        // Wings-RS wraps the figures in a "stats" envelope; older builds returned
        // them flat, so accept either.
        $data = $response['stats'] ?? $response;

        return [
            'cpu' => $data['cpu']['used'] ?? $data['cpu_used'] ?? 0,
            'memory' => [
                'total' => $data['memory']['total'] ?? $data['memory_total'] ?? 0,
                'used' => $data['memory']['used'] ?? $data['memory_used'] ?? 0,
            ],
            'swap' => [
                'total' => $data['swap']['total'] ?? $data['swap_total'] ?? 0,
                'used' => $data['swap']['used'] ?? $data['swap_used'] ?? 0,
            ],
            'disk' => [
                'total' => $data['disk']['total'] ?? $data['disk_total'] ?? 0,
                'used' => $data['disk']['used'] ?? $data['disk_used'] ?? 0,
            ],
        ];
    }
}
