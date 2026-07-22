<?php

namespace Everest\Console\Commands\Billing;

use Illuminate\Console\Command;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\Log;
use Everest\Services\Billing\ThreatIndexService;

class CalculateOrderThreatIndexCommand extends Command
{
    protected $description = 'Calculate the threat index for pending orders.';

    protected $signature = 'p:billing:calculate-order-threat-index
                            {--recalculate : Reset and recompute scores for all non-expired/cancelled orders}
                            {--order= : Recalculate the threat index for a specific order ID}';

    public function __construct(private readonly ThreatIndexService $threatIndexService)
    {
        parent::__construct();
    }

    public function handle(): void
    {
        if ($orderId = $this->option('order')) {
            $this->recalculateSingle((int) $orderId);

            return;
        }

        if ($this->option('recalculate')) {
            $this->info('Resetting threat index for all active orders…');
            Order::whereNotIn('status', [Order::STATUS_EXPIRED, Order::STATUS_CANCELLED])
                ->update(['threat_index' => -1]);
        }

        $processed = 0;
        $skipped = 0;

        Order::where('threat_index', -1)
            ->with('user')
            ->chunkById(100, function ($orders) use (&$processed, &$skipped) {
                foreach ($orders as $order) {
                    if ($order->user === null) {
                        Log::warning('Skipping threat index calculation: user not found for order', [
                            'order_id' => $order->id,
                            'user_id' => $order->user_id,
                        ]);
                        ++$skipped;
                        continue;
                    }

                    $this->threatIndexService->recalculate($order);
                    ++$processed;
                }
            });

        $this->info("Threat index calculated for {$processed} order(s). Skipped {$skipped} orphaned order(s).");
    }

    private function recalculateSingle(int $orderId): void
    {
        $order = Order::find($orderId);

        if (!$order) {
            $this->error("Order #{$orderId} not found.");

            return;
        }

        $old = $order->threat_index;
        $this->threatIndexService->recalculate($order);
        $order->refresh();

        $this->info("Order #{$orderId}: threat index updated from {$old} → {$order->threat_index}.");
    }
}
