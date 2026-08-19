<?php

namespace Everest\Http\Controllers\Api\Application;

use Illuminate\Http\JsonResponse;
use Everest\Services\Queue\QueueHealthService;
use Everest\Http\Requests\Api\Application\OverviewRequest;

class QueueHealthController extends ApplicationApiController
{
    public function __construct(
        private QueueHealthService $queueHealth,
    ) {
        parent::__construct();
    }

    /**
     * Worker-queue health: per-lane depth, throughput, wait and runtime, plus
     * failed-job totals.
     *
     * Separate from `/overview` because it reads the queue driver rather than
     * the database, and because it is useful on its own for monitoring. The
     * underlying snapshot is cached for a few seconds and shared between
     * callers, so it is safe to poll.
     */
    public function index(OverviewRequest $request): JsonResponse
    {
        return new JsonResponse($this->queueHealth->snapshot());
    }
}
