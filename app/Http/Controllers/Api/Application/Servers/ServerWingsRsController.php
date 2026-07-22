<?php

namespace Everest\Http\Controllers\Api\Application\Servers;

use Everest\Models\Server;
use Illuminate\Http\JsonResponse;
use Everest\Repositories\Wings\DaemonWingsRsRepository;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Servers\WingsRsServerReadRequest;

class ServerWingsRsController extends ApplicationApiController
{
    public function __construct(
        private DaemonWingsRsRepository $wingsRsRepository,
    ) {
        parent::__construct();
    }

    public function status(WingsRsServerReadRequest $request, Server $server): JsonResponse
    {
        $node = $server->node;

        return new JsonResponse([
            'supercharged' => $node->isSupercharged(),
            'wings_type' => $node->wings_type,
            'wings_version' => $node->wings_version,
        ]);
    }

    public function stats(WingsRsServerReadRequest $request, Server $server): JsonResponse
    {
        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'This server node is not running Wings-RS.'], 400);
        }

        $data = $this->wingsRsRepository->setServer($server)->getSystemStats();

        return new JsonResponse($data);
    }

    public function installLogs(WingsRsServerReadRequest $request, Server $server): JsonResponse
    {
        if (!$server->node->isSupercharged()) {
            return new JsonResponse(['error' => 'This server node is not running Wings-RS.'], 400);
        }

        $lines = (int) $request->query('lines', 100);
        $lines = max(1, min($lines, 5000));

        try {
            $content = $this->wingsRsRepository->setServer($server)->getInstallLogs($lines);
        } catch (DaemonConnectionException $exception) {
            if ($exception->getStatusCode() === 404) {
                return new JsonResponse([
                    'content' => [],
                    'missing' => true,
                ]);
            }

            throw $exception;
        }

        return new JsonResponse([
            'content' => $content,
            'missing' => false,
        ]);
    }
}
