<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Jobs\DownloadModJob;
use Everest\Jobs\InstallModpackJob;
use Everest\Models\DownloadQueue;
use Everest\Models\Server;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Servers\Mods\DownloadModRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\GetDownloadQueueRequest;

class ModQueueController extends ClientApiController
{
    /**
     * List all queue items for a server, newest first.
     * Only returns items from the last 24 hours to keep the panel manageable.
     */
    public function index(GetDownloadQueueRequest $request, Server $server): JsonResponse
    {
        $items = DownloadQueue::where('server_id', $server->id)
            ->where('created_at', '>=', now()->subDay())
            ->orderByRaw("FIELD(status, 'downloading', 'pending', 'failed', 'completed')")
            ->orderBy('created_at', 'desc')
            ->get([
                'uuid', 'provider', 'source', 'project_id', 'file_id',
                'file_name', 'error_message', 'install_log', 'status', 'phase', 'parent_id',
                'total_children', 'completed_children', 'failed_children',
                'started_at', 'completed_at', 'created_at',
            ]);

        return response()->json(['data' => $items]);
    }

    /**
     * Cancel a pending queue item. Items that are already downloading cannot be cancelled.
     */
    public function cancel(DownloadModRequest $request, Server $server, string $queueUuid): JsonResponse
    {
        $item = DownloadQueue::where('server_id', $server->id)
            ->where('uuid', $queueUuid)
            ->firstOrFail();

        if ($item->status !== DownloadQueue::STATUS_PENDING) {
            return response()->json([
                'error' => 'Only pending queue items can be cancelled.',
            ], 422);
        }

        $item->delete();

        return response()->json(['cancelled' => true]);
    }

    /**
     * Bulk-delete queue items. If any targeted items are actively downloading
     * and `force` is not set, returns a 422 with details so the UI can warn.
     * Passing `force=true` removes them regardless; the background job will
     * continue until it finishes but will write to a gone record (safe, no-op).
     *
     * Body: { uuids?: string[], force?: bool }
     * Omitting `uuids` targets every item for the server.
     */
    public function bulkClear(DownloadModRequest $request, Server $server): JsonResponse
    {
        $uuids = $request->input('uuids');
        $force = (bool) $request->input('force', false);

        $query = DownloadQueue::where('server_id', $server->id);

        if (!empty($uuids)) {
            $query->whereIn('uuid', $uuids);
        }

        $items = $query->get(['id', 'uuid', 'status']);

        $active = $items->filter(fn ($i) => $i->status === DownloadQueue::STATUS_DOWNLOADING);

        if ($active->isNotEmpty() && !$force) {
            return response()->json([
                'error'        => 'Some items are currently downloading.',
                'active_count' => $active->count(),
                'active_uuids' => $active->pluck('uuid')->values(),
            ], 422);
        }

        // Never delete a row whose job is still running: the worker keeps a handle on
        // the model and continues writing files to disk, so removing it would orphan an
        // install (files keep landing while the UI shows an empty queue). `force` only
        // suppresses the warning above and clears everything else.
        $deletable = $items->reject(fn ($i) => $i->status === DownloadQueue::STATUS_DOWNLOADING);

        $deleted = $deletable->count();
        DownloadQueue::whereIn('id', $deletable->pluck('id'))->delete();

        return response()->json(['deleted' => $deleted]);
    }

    /**
     * Retry a failed queue item by re-queuing it.
     */
    public function retry(DownloadModRequest $request, Server $server, string $queueUuid): JsonResponse
    {
        $item = DownloadQueue::where('server_id', $server->id)
            ->where('uuid', $queueUuid)
            ->firstOrFail();

        if ($item->status !== DownloadQueue::STATUS_FAILED) {
            return response()->json([
                'error' => 'Only failed queue items can be retried.',
            ], 422);
        }

        $item->update([
            'status'             => DownloadQueue::STATUS_PENDING,
            'error_message'      => null,
            'install_log'        => null,
            // Reset progress to null/0 so a modpack retry does a full clean re-sweep
            // from the start (phase=null re-runs overrides; skip-existing keeps it cheap).
            'phase'              => null,
            'completed_children' => 0,
            'failed_children'    => 0,
            'started_at'         => null,
            'completed_at'       => null,
        ]);

        if ($item->source === 'modpack') {
            // Re-run from the start. A retry never re-wipes (destructive), but it does
            // re-ensure the loader — so a loader-phase failure can be retried. The
            // loader step is skipped automatically when resuming the mods stage.
            dispatch(new InstallModpackJob($item, wipeServer: false, installLoader: true));
        } else {
            dispatch(new DownloadModJob($item));
        }

        return response()->json(['queued' => true, 'queue_id' => $item->uuid]);
    }
}
