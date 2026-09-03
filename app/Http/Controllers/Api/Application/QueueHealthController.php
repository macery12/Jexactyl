<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Services\Queue\QueueHealthService;
use Everest\Services\Queue\FailedJobRepository;
use Everest\Http\Requests\Api\Application\Queues\QueueHealthRequest;
use Everest\Http\Requests\Api\Application\Queues\RetryFailedJobRequest;
use Everest\Http\Requests\Api\Application\Queues\DeleteFailedJobRequest;

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
        $job = $this->failedJobs->summary($uuid);

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

    /**
     * Re-dispatch a selection.
     *
     * Bounded by the request rules rather than by anything here: a retry runs
     * real work, so "retry everything that ever failed" is not an operation
     * this endpoint offers.
     */
    public function retryMany(RetryFailedJobRequest $request): JsonResponse
    {
        $uuids = array_values(array_filter((array) $request->input('uuids', [])));

        if ($uuids === []) {
            return new JsonResponse(['errors' => [['code' => 'NothingSelected', 'detail' => 'No failed jobs were selected.']]], 422);
        }

        // Logged before the work, not after. A batch that dies part-way through
        // has still re-dispatched everything it reached, and an audit trail that
        // only records completed batches is one that goes quiet exactly when it
        // matters.
        Activity::event('admin:queues:retry')
            ->property('uuids', $uuids)
            ->property('requested', count($uuids))
            ->description('A selection of failed jobs was re-dispatched')
            ->log();

        $retried = $this->failedJobs->retryMany($uuids);

        return new JsonResponse(['retried' => $retried, 'requested' => count($uuids)]);
    }

    /**
     * Discard one failure.
     *
     * Unrecoverable: the row is the only copy of the payload, so this is logged
     * with everything needed to say afterwards what was thrown away.
     */
    public function destroy(DeleteFailedJobRequest $request, string $uuid): JsonResponse|Response
    {
        $job = $this->failedJobs->summary($uuid);

        if ($job === null) {
            return new JsonResponse(['errors' => [['code' => 'NotFound', 'detail' => 'No failed job with that identifier.']]], 404);
        }

        if (!$this->failedJobs->delete($uuid)) {
            return new JsonResponse(['errors' => [['code' => 'DeleteFailed', 'detail' => 'The failed job could not be discarded. Check the panel log.']]], 500);
        }

        Activity::event('admin:queues:delete')
            ->property('job', $job['job'])
            ->property('queue', $job['queue'])
            ->property('uuid', $uuid)
            ->description('A failed job was discarded')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Discard a selection, or sweep a scope.
     *
     * The two shapes are deliberately the only two: a list of uuids the admin
     * has actually looked at, or a scope that names a queue, an age, or both.
     * There is no shape that means "delete everything" -- an unscoped flush is
     * one mis-click away from destroying every payload in the retention window.
     * The request rules keep the two apart, so which branch runs is decided by
     * the presence of the field rather than by what survives a filter.
     *
     * Both branches log before they destroy anything. A sweep logs one event
     * carrying its filter and count rather than one per row, because forty
     * identical log lines are not an audit trail -- but it logs it up front, so
     * a request that dies part-way through has still said what it was doing.
     */
    public function destroyMany(DeleteFailedJobRequest $request): JsonResponse
    {
        if ($request->has('uuids')) {
            $uuids = array_values(array_filter((array) $request->input('uuids', [])));

            if ($uuids === []) {
                return new JsonResponse(['errors' => [['code' => 'NothingSelected', 'detail' => 'No failed jobs were selected.']]], 422);
            }

            // The uuids themselves, not just a count: the row is the only copy
            // of the payload, so afterwards this log line is the only record
            // that a particular failure ever existed.
            Activity::event('admin:queues:delete')
                ->property('uuids', $uuids)
                ->property('requested', count($uuids))
                ->description('A selection of failed jobs was discarded')
                ->log();

            $deleted = $this->failedJobs->deleteMany($uuids);

            return new JsonResponse(['deleted' => $deleted, 'requested' => count($uuids)]);
        }

        $scope = $this->sweepScope($request);

        // Refused before anything is written, so a rejected request leaves no
        // audit entry claiming a sweep happened.
        if ($scope[0] === null && $scope[1] === null) {
            return new JsonResponse(['errors' => [[
                'code' => 'UnscopedSweep',
                'detail' => 'A sweep must name a queue, an age, or both. Discarding every failure at once is not supported.',
            ]]], 422);
        }

        Activity::event('admin:queues:delete')
            ->property('queue', $scope[0])
            ->property('olderThanDays', $scope[1])
            ->property('matched', $this->failedJobs->countMatching(...$scope))
            ->property('cap', FailedJobRepository::MAX_SWEEP_ROWS)
            ->description('Failed jobs matching a scope were discarded')
            ->log();

        // Never null past the guard above; the repository refuses an unscoped
        // sweep on its own account as well, and this is the second lock.
        $deleted = $this->failedJobs->purge(...$scope) ?? 0;

        // A scope wider than one request will take is not an error, and not
        // something to paper over either: report what is left so the operator
        // can decide to go again rather than assuming the lane is clear.
        return new JsonResponse([
            'deleted' => $deleted,
            'remaining' => $this->failedJobs->countMatching(...$scope),
        ]);
    }

    /**
     * How many rows a sweep would take, so the confirmation can name the exact
     * number before anything is destroyed. Read-only, but it answers a question
     * only the delete capability has any business asking -- and it refuses an
     * unscoped call for the same reason the sweep does, rather than quietly
     * reporting the size of the whole table.
     */
    public function sweepPreview(DeleteFailedJobRequest $request): JsonResponse
    {
        $scope = $this->sweepScope($request);

        if ($scope[0] === null && $scope[1] === null) {
            return new JsonResponse(['errors' => [[
                'code' => 'UnscopedSweep',
                'detail' => 'A sweep must name a queue, an age, or both.',
            ]]], 422);
        }

        return new JsonResponse([
            'count' => $this->failedJobs->countMatching(...$scope),
            'cap' => FailedJobRepository::MAX_SWEEP_ROWS,
        ]);
    }

    /**
     * The sweep scope, normalised once so the preview and the sweep itself
     * cannot disagree about what a request asked for.
     *
     * @return array{0: ?string, 1: ?int}
     */
    private function sweepScope(DeleteFailedJobRequest $request): array
    {
        $queue = $request->input('queue');
        $olderThanDays = $request->input('olderThanDays');

        return [
            is_string($queue) && $queue !== '' ? $queue : null,
            is_numeric($olderThanDays) ? (int) $olderThanDays : null,
        ];
    }
}
