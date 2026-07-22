<?php

namespace Everest\Console\Commands\Billing;

use Everest\Models\User;
use Illuminate\Console\Command;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CleanupOrdersCommand extends Command
{
    protected $description = 'Expire stale pending billing orders and delete old expired orders.';

    protected $signature = 'p:billing:cleanup-orders'
        . ' {--hours=24 : Hours before a pending order is considered expired}'
        . ' {--delete-after=720 : Hours an expired order is kept before deletion}';

    public function __construct()
    {
        parent::__construct();
    }

    public function handle(): void
    {
        $expireAfterHours  = max(1, (int) $this->option('hours'));
        $deleteAfterHours  = max(1, (int) $this->option('delete-after'));

        $expiryCutoff = now()->subHours($expireAfterHours);
        $deleteCutoff = now()->subHours($deleteAfterHours);

        $expiredCount = 0;

        Order::where('status', Order::STATUS_PENDING)
            ->where('created_at', '<', $expiryCutoff)
            ->with('transaction')
            ->chunk(500, function ($stale) use (&$expiredCount) {
                foreach ($stale as $order) {
                    if (!User::where('id', $order->user_id)->exists()) {
                        $order->delete();
                        continue;
                    }

                    try {
                        DB::transaction(function () use ($order) {
                            $order->forceFill(['status' => Order::STATUS_EXPIRED])->save();

                            if ($order->transaction) {
                                $order->transaction->update(['status' => 'expired']);
                            }
                        });

                        ++$expiredCount;
                    } catch (\Exception $ex) {
                        Log::warning('CleanupOrdersCommand: failed to expire order', [
                            'order_id' => $order->id,
                            'error'    => $ex->getMessage(),
                        ]);
                    }
                }
            });

        $deleteCount = 0;

        Order::where('status', Order::STATUS_EXPIRED)
            ->where('updated_at', '<', $deleteCutoff)
            ->each(function (Order $order) use (&$deleteCount) {
                try {
                    $order->delete();
                    ++$deleteCount;
                } catch (\Exception $ex) {
                    Log::warning('CleanupOrdersCommand: failed to delete expired order', [
                        'order_id' => $order->id,
                        'error'    => $ex->getMessage(),
                    ]);
                }
            });

        $this->info("Expired {$expiredCount} pending order(s). Deleted {$deleteCount} expired order(s).");
        Log::info('CleanupOrdersCommand completed', [
            'expired' => $expiredCount,
            'deleted' => $deleteCount,
        ]);
    }
}
