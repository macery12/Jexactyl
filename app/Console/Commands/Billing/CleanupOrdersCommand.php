<?php

namespace Everest\Console\Commands\Billing;

use Everest\Models\User;
use Illuminate\Http\Request;
use Illuminate\Console\Command;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\PayPalWebhookEventService;
use Everest\Services\Billing\CheckoutReservationService;

class CleanupOrdersCommand extends Command
{
    protected $description = 'Recover captured fulfillment, expire stale pending orders, and delete safe old expired orders.';

    protected $signature = 'p:billing:cleanup-orders'
        . ' {--hours=24 : Hours before a pending order is considered expired}'
        . ' {--delete-after=720 : Hours an expired order is kept before deletion}';

    public function __construct(
        private CheckoutReservationService $reservationService,
        private ServerFulfillmentService $fulfillmentService,
    ) {
        parent::__construct();
    }

    public function handle(): void
    {
        $expireAfterHours  = max(1, (int) $this->option('hours'));
        $deleteAfterHours  = max(1, (int) $this->option('delete-after'));

        $expiryCutoff = now()->subHours($expireAfterHours);
        $deleteCutoff = now()->subHours($deleteAfterHours);

        $recoveredCount = 0;
        Order::query()
            ->where('status', Order::STATUS_FULFILLING)
            ->where('fulfillment_started_at', '<=', now()->subMinutes(15))
            ->whereHas('transaction', function ($query): void {
                $query->where(function ($capture): void {
                    $capture->whereNotNull('capture_id')->orWhereNotNull('captured_at');
                });
            })
            ->chunkById(100, function ($stale) use (&$recoveredCount): void {
                foreach ($stale as $order) {
                    try {
                        $this->fulfillmentService->fulfillOrder(new Request(), $order);
                        ++$recoveredCount;
                    } catch (\Throwable $exception) {
                        Log::critical('CleanupOrdersCommand: stale captured fulfillment requires reconciliation', [
                            'order_id' => $order->id,
                            'exception_class' => $exception::class,
                        ]);
                    }
                }
            });

        $expiredCount = 0;

        Order::where('status', Order::STATUS_PENDING)
            ->where('created_at', '<', $expiryCutoff)
            ->chunk(500, function ($stale) use (&$expiredCount) {
                foreach ($stale as $order) {
                    try {
                        $changed = DB::transaction(function () use ($order): bool {
                            /** @var Order|null $locked */
                            $locked = Order::query()
                                ->whereKey($order->id)
                                ->lockForUpdate()
                                ->first();
                            if ($locked === null || $locked->status !== Order::STATUS_PENDING) {
                                return false;
                            }

                            if (
                                !in_array($locked->type, [Order::TYPE_REN, Order::TYPE_UPG], true)
                                && $locked->server_id !== null
                            ) {
                                Log::critical('CleanupOrdersCommand: linked pending order requires reconciliation', [
                                    'order_id' => $locked->id,
                                    'server_id' => $locked->server_id,
                                ]);

                                return false;
                            }

                            $transaction = $locked->transaction()->lockForUpdate()->first();
                            if (
                                $this->hasTransactionPaymentEvidence($transaction)
                                || $this->hasUnresolvedPayPalWebhookEvidence($transaction)
                            ) {
                                Log::critical('CleanupOrdersCommand: pending order contains payment evidence and requires reconciliation', [
                                    'order_id' => $locked->id,
                                ]);

                                return false;
                            }

                            if (!User::query()->whereKey($locked->user_id)->exists()) {
                                $locked->delete();

                                return true;
                            }

                            $locked->forceFill(['status' => Order::STATUS_EXPIRED])->saveOrFail();
                            $transaction?->forceFill(['status' => 'expired'])->saveOrFail();
                            $this->reservationService->releaseLocked($locked, $transaction);

                            return true;
                        });

                        if ($changed) {
                            ++$expiredCount;
                        }
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
                    $deleted = DB::transaction(function () use ($order): bool {
                        /** @var Order|null $locked */
                        $locked = Order::query()->whereKey($order->id)->lockForUpdate()->first();
                        if ($locked === null || $locked->status !== Order::STATUS_EXPIRED) {
                            return false;
                        }

                        $transaction = $locked->transaction()->lockForUpdate()->first();
                        if (
                            (
                                !in_array($locked->type, [Order::TYPE_REN, Order::TYPE_UPG], true)
                                && $locked->server_id !== null
                            )
                            || $this->hasTransactionPaymentEvidence($transaction)
                            || $this->hasUnresolvedPayPalWebhookEvidence($transaction)
                        ) {
                            Log::critical('CleanupOrdersCommand: expired order contains reconciliation evidence and was retained', [
                                'order_id' => $locked->id,
                                'server_id' => $locked->server_id,
                            ]);

                            return false;
                        }

                        return (bool) $locked->delete();
                    });
                    if ($deleted) {
                        ++$deleteCount;
                    }
                } catch (\Exception $ex) {
                    Log::warning('CleanupOrdersCommand: failed to delete expired order', [
                        'order_id' => $order->id,
                        'error'    => $ex->getMessage(),
                    ]);
                }
            });

        $this->info("Recovered {$recoveredCount} captured order(s). Expired {$expiredCount} pending order(s). Deleted {$deleteCount} expired order(s).");
        Log::info('CleanupOrdersCommand completed', [
            'recovered' => $recoveredCount,
            'expired' => $expiredCount,
            'deleted' => $deleteCount,
        ]);
    }

    private function hasTransactionPaymentEvidence(?PaymentTransaction $transaction): bool
    {
        return $transaction !== null && (
            (bool) $transaction->capture_id
            || $transaction->captured_at !== null
            || (bool) $transaction->provider_negative_status
            || $transaction->provider_negative_at !== null
            || !empty($transaction->provider_negative_events)
        );
    }

    private function hasUnresolvedPayPalWebhookEvidence(?PaymentTransaction $transaction): bool
    {
        if (
            $transaction === null
            || $transaction->processor !== 'paypal'
            || !is_string($transaction->external_id)
            || $transaction->external_id === ''
        ) {
            return false;
        }

        return DB::table('paypal_webhook_events')
            ->where('paypal_order_id', $transaction->external_id)
            ->whereIn('status', [
                PayPalWebhookEventService::STATUS_PROCESSING,
                PayPalWebhookEventService::STATUS_FAILED,
            ])
            ->lockForUpdate()
            ->first(['id']) !== null;
    }
}
