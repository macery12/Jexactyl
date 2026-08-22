<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Services\Queue\QueueHealthService;
use Everest\Services\Queue\FailedJobRepository;
use Everest\Http\Requests\Api\Application\Queues\QueueHealthRequest;
use Everest\Http\Requests\Api\Application\Queues\RetryFailedJobRequest;

class QueueHealthController extends ApplicationApiController
{
    public function __construct(
        private QueueHealthService $queueHealth,
        private FailedJobRepository $failedJobs,
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
    public function index(QueueHealthRequest $request): JsonResponse
    {
        return new JsonResponse($this->queueHealth->snapshot());
    }

    /**
     * The failures behind the count on the health snapshot.
     *
     * Kept off `index` deliberately: the snapshot is polled every fifteen
     * seconds by every open admin tab, and a page of stack traces has no
     * business riding along with it.
     */
    public function failed(QueueHealthRequest $request): JsonResponse
    {
        $perPage = (int) $request->query('per_page', 25);
        $page = (int) $request->query('page', 1);
        $queue = $request->query('queue');

        return new JsonResponse($this->failedJobs->paginate(
            max(1, min(100, $perPage)),
            max(1, $page),
            is_string($queue) && $queue !== '' ? $queue : null,
        ));
    }

    /**
     * One failure with its full stack trace.
     */
    public function show(QueueHealthRequest $request, string $uuid): JsonResponse
    {
        $job = $this->failedJobs->find($uuid);

        if ($job === null) {
            return new JsonResponse(['errors' => [['code' => 'NotFound', 'detail' => 'No failed job with that identifier.']]], 404);
        }

        return new JsonResponse($job);
    }

    /**
     * Re-dispatch a failed job.
     *
     * This actually runs the work again -- mail gets sent, nodes get called --
     * so it is logged with the job class and queue, and sits behind its own
     * capability rather than the read one.
     */
    public function retry(RetryFailedJobRequest $request, string $uuid): JsonResponse|Response
    {
        $job = $this->failedJobs->find($uuid);

        if ($job === null) {
            return new JsonResponse(['errors' => [['code' => 'NotFound', 'detail' => 'No failed job with that identifier.']]], 404);
        }

        if (!$this->failedJobs->retry($uuid)) {
            return new JsonResponse(['errors' => [['code' => 'RetryFailed', 'detail' => 'The job could not be pushed back onto its queue. Check the panel log.']]], 500);
        }

        Activity::event('admin:queues:retry')
            ->property('job', $job['job'])
            ->property('queue', $job['queue'])
            ->property('uuid', $uuid)
            ->description('A failed job was re-dispatched onto its queue')
            ->log();

        return $this->returnNoContent();
    }
}
