<?php

namespace Everest\Jobs;

use Everest\Models\DownloadQueue;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Everest\Services\Plugins\PluginInstallService;
use Illuminate\Queue\Attributes\DeleteWhenMissingModels;

#[DeleteWhenMissingModels]
class DownloadModJob extends Job implements ShouldQueue
{
    use InteractsWithQueue;
    use SerializesModels;

    /**
     * Number of seconds the job can run before timing out.
     */
    public int $timeout = 360;

    /**
     * Do not retry automatically — failed items surface a retry button in the UI.
     */
    public int $tries = 1;

    public function __construct(public DownloadQueue $queueItem)
    {
        // No queue is set here on purpose — routing lives in config/queue.php,
        // and assigning $this->queue would silently override it.
    }

    public function handle(PluginInstallService $pluginInstallService): void
    {
        $item = $this->queueItem;

        $item->update([
            'status'     => DownloadQueue::STATUS_DOWNLOADING,
            'started_at' => now(),
        ]);

        try {
            $result = $pluginInstallService->installFromProvider(
                $item->server,
                $item->provider,
                $item->source,
                $item->project_id,
                $item->file_id,
                $item->user_id,
            );

            $fileName = $result['file']['name'] ?? null;

            $item->update([
                'status'       => DownloadQueue::STATUS_COMPLETED,
                'file_name'    => $fileName,
                'completed_at' => now(),
            ]);

            // Invalidate the installed addons cache so the file list refreshes.
            $type = $item->source === 'plugin' ? 'plugins' : 'mods';
            /** @var \Everest\Models\Server $server */
            $server = $item->server;
            Cache::forget("server:{$server->uuid}:installed:{$type}");
        } catch (\Exception $e) {
            $item->update([
                'status'        => DownloadQueue::STATUS_FAILED,
                'error_message' => $e->getMessage(),
                'completed_at'  => now(),
            ]);
        }
    }

    /**
     * Called when the job itself fails at the queue infrastructure level
     * (e.g., worker crash, serialization failure).
     */
    public function failed(\Throwable $exception): void
    {
        Log::error('DownloadModJob infrastructure failure', [
            'queue_item_id' => $this->queueItem->id,
            'error'         => $exception->getMessage(),
        ]);

        $this->queueItem->update([
            'status'        => DownloadQueue::STATUS_FAILED,
            'error_message' => 'Download worker encountered an unexpected error.',
            'completed_at'  => now(),
        ]);
    }
}
