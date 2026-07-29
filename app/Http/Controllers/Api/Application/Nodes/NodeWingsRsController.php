<?php

namespace Everest\Http\Controllers\Api\Application\Nodes;

use Everest\Models\Node;
use Illuminate\Http\JsonResponse;
use Everest\Services\Nodes\WingsDetectionService;
use Everest\Repositories\Wings\DaemonWingsRsRepository;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Nodes\WingsRsNodeReadRequest;
use Everest\Http\Requests\Api\Application\Nodes\WingsRsNodeUpdateRequest;
use Everest\Http\Requests\Api\Application\Nodes\WingsRsNodeUpgradeRequest;

class NodeWingsRsController extends ApplicationApiController
{
    public function __construct(
        private WingsDetectionService $detectionService,
        private DaemonWingsRsRepository $wingsRsRepository,
    ) {
        parent::__construct();
    }

    /**
     * POST /api/application/nodes/{node}/detect — Detect Wings-RS and update node type.
     */
    public function detect(WingsRsNodeUpdateRequest $request, Node $node): JsonResponse
    {
        $isSupercharged = $this->detectionService->detect($node);
        $node->refresh();

        return new JsonResponse([
            'detected' => $isSupercharged,
            'supercharged' => $isSupercharged,
            'wings_type' => $node->wings_type,
            'wings_version' => $node->wings_version,
            'detected_at' => $node->wings_detected_at?->toIso8601String(),
        ]);
    }

    /**
     * GET /api/application/nodes/{node}/overview — Wings-RS system overview.
     */
    public function overview(WingsRsNodeReadRequest $request, Node $node): JsonResponse
    {
        if (!$node->isSupercharged()) {
            return new JsonResponse(['error' => 'This node is not running Wings-RS.'], 400);
        }

        $data = $this->wingsRsRepository->setNode($node)->getSystemOverview();

        return new JsonResponse($data);
    }

    /**
     * GET /api/application/nodes/{node}/stats — Wings-RS real-time stats.
     */
    public function stats(WingsRsNodeReadRequest $request, Node $node): JsonResponse
    {
        if (!$node->isSupercharged()) {
            return new JsonResponse(['error' => 'This node is not running Wings-RS.'], 400);
        }

        $data = $this->wingsRsRepository->setNode($node)->getSystemStats();

        return new JsonResponse($data);
    }

    /**
     * GET /api/application/nodes/{node}/logs — List Wings-RS log files.
     */
    public function logs(WingsRsNodeReadRequest $request, Node $node): JsonResponse
    {
        if (!$node->isSupercharged()) {
            return new JsonResponse(['error' => 'This node is not running Wings-RS.'], 400);
        }

        $data = $this->wingsRsRepository->setNode($node)->getSystemLogs();

        return new JsonResponse($data);
    }

    /**
     * GET /api/application/nodes/{node}/logs/{file} — Read specific log file.
     */
    public function logContents(WingsRsNodeReadRequest $request, Node $node, string $file): JsonResponse
    {
        if (!$node->isSupercharged()) {
            return new JsonResponse(['error' => 'This node is not running Wings-RS.'], 400);
        }

        $lines = (int) $request->query('lines', 200);
        $lines = max(1, min($lines, 5000));

        $content = $this->wingsRsRepository->setNode($node)->getSystemLogContents($file, $lines);

        return new JsonResponse([
            'file' => $file,
            'content' => $content,
        ]);
    }

    /**
     * POST /api/application/nodes/{node}/upgrade — Trigger Wings-RS self-upgrade.
     *
     * The daemon is responsible for scheduling the upgrade. To prevent command
     * injection the Panel does not accept caller-controlled download headers or
     * restart commands; the required daemon payload fields are populated from
     * trusted Panel configuration.
     */
    public function upgrade(WingsRsNodeUpgradeRequest $request, Node $node): JsonResponse
    {
        if (!$node->isSupercharged()) {
            return new JsonResponse(['error' => 'This node is not running Wings-RS.'], 400);
        }

        $request->validate([
            // Must be HTTPS to prevent MITM on the binary download.
            'url' => ['required', 'url', 'regex:/^https:\/\//i'],
            // Must be a 64-character lowercase hex string (SHA-256).
            'sha256' => ['required', 'string', 'size:64', 'regex:/^[0-9a-f]{64}$/'],
        ]);

        $applied = $this->wingsRsRepository->setNode($node)->upgradeSystem(
            $request->input('url'),
            $request->input('sha256')
        );

        if (!$applied) {
            return new JsonResponse([
                'success' => false,
                'applied' => false,
                'message' => 'Wings-RS is configured to ignore Panel-initiated upgrades.',
            ]);
        }

        return new JsonResponse([
            'success' => true,
            'applied' => true,
            'message' => 'The Wings-RS upgrade was accepted and scheduled.',
        ], 202);
    }
}
