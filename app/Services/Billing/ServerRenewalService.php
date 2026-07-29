<?php

namespace Everest\Services\Billing;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\CouponUsage;
use Everest\Exceptions\DisplayException;
use Everest\Services\Servers\SuspensionService;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

class ServerRenewalService
{
    public function __construct(
        private SuspensionService $suspensionService,
        private CreateOrderService $orderService,
    ) {
    }

    /**
     * Renew a server by extending its renewal date.
     * This handles both free and paid server renewals.
     *
     * For free servers: Resets renewal date to configured days from now
     * For paid servers: Adds configured days to existing renewal date (extends the time)
     *
     * If server is past due but still within grace period, the renewal days are
     * reduced by the number of past due days to prevent users from getting free time.
     *
     * @return array{server: Server, order: Order}
     */
    public function renew(
        Server $server,
        Product $product,
        ?int $couponId = null,
        int $billingDays = 0,
        ?Order $sourceOrder = null,
    ): array {
        if ($billingDays <= 0) {
            $billingDays = BillingDefaults::defaultBillingDays();
        }

        // Defense in depth for every caller, not only the HTTP controller:
        // clients never choose the entitlement period of a truly free product.
        if ($sourceOrder === null && $product->isFree()) {
            $billingDays = $product->getRenewalDays();
        }

        return DB::transaction(function () use ($server, $product, $couponId, $billingDays, $sourceOrder) {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();

            if ((int) $lockedServer->billing_product_id !== (int) $product->id) {
                throw new DisplayException('This server does not use this product.');
            }

            if ($lockedServer->isDeletionScheduled()) {
                throw new ConflictHttpException('This server is scheduled for deletion. Cancel deletion before renewing.');
            }
            if ($lockedServer->pending_plan_change_order_id !== null) {
                throw new DisplayException('This server has a paid plan change awaiting completion. Finish or cancel it before renewing.');
            }
            if ($lockedServer->scheduled_billing_product_id !== null) {
                throw new DisplayException('This server has a plan change scheduled for renewal. Apply or cancel it before renewing.');
            }

            if ($sourceOrder !== null) {
                /** @var Order $order */
                $order = Order::query()->whereKey($sourceOrder->id)->lockForUpdate()->firstOrFail();
                if (
                    $order->status !== Order::STATUS_FULFILLING
                    || $order->type !== Order::TYPE_REN
                    || (int) $order->server_id !== (int) $lockedServer->id
                    || (int) $order->user_id !== (int) $lockedServer->owner_id
                    || (int) $order->product_id !== (int) $product->id
                    || !hash_equals((string) $order->fulfillment_claim, (string) $sourceOrder->fulfillment_claim)
                ) {
                    throw new DisplayException('The paid renewal order does not match this server.');
                }

                $billingDays = (int) $order->billing_days;
                $couponId = $order->coupon_id;
            } else {
                // Free renewals create their own authoritative order. Paid renewals
                // pass the provider-backed order so the payment can only be applied once.
                $order = $this->orderService->create(
                    null,
                    $lockedServer->user,
                    $product,
                    Order::STATUS_PENDING,
                    Order::TYPE_REN,
                    $couponId,
                    null,
                    [
                        'billing_days' => $billingDays,
                        'server_id' => $lockedServer->id,
                        'node_id' => $lockedServer->node_id,
                    ]
                );
            }

            // Unsuspend the server if it was suspended due to billing
            if ($lockedServer->isSuspended()) {
                $this->suspensionService->toggle($lockedServer, SuspensionService::ACTION_UNSUSPEND);
            }

            // Resolve and persist the selected billing cycle for future renewals.
            // This ensures coupon-driven free renewals still lock in the chosen cycle.
            $resolvedBillingDays = $billingDays > 0
                ? $billingDays
                : ($lockedServer->billing_days > 0 ? $lockedServer->billing_days : $product->getRenewalDays());

            // Use the resolved billing days as the renewal period baseline.
            $renewalDays = $resolvedBillingDays;

            // Calculate past due days if server is overdue
            $pastDueDays = 0;
            if ($lockedServer->renewal_date && $lockedServer->renewal_date->isPast()) {
                // Carbon 3 returns a signed value by default. Measure from the
                // overdue date toward now so this is always a positive debit,
                // never an accidental bonus day.
                $pastDueDays = (int) floor(
                    $lockedServer->renewal_date->diffInDays(Carbon::now())
                );

                // Get the suspension threshold (grace period) for this billing cycle
                $suspensionThreshold = $product->getSuspensionThresholdForBillingCycle($resolvedBillingDays);

                // Only adjust renewal days if server is still within grace period (able to be renewed)
                // If past the grace period, they shouldn't be able to renew anyway
                if ($pastDueDays <= $suspensionThreshold) {
                    // Subtract past due days from renewal days, but ensure we give at least 1 day
                    $renewalDays = max(1, $renewalDays - $pastDueDays);
                }
            }

            if ($product->isFree()) {
                // Free servers: Reset renewal date to configured days from now
                $newRenewalDate = Carbon::now()->addDays($renewalDays)->toDateTimeString();
            } else {
                // Paid servers: Add configured days to existing renewal date to extend the time
                // Use copy() to avoid mutating the original Carbon instance
                // If renewal_date is null or in the past, start from now instead
                $baseDate = $lockedServer->renewal_date && $lockedServer->renewal_date->isFuture()
                    ? $lockedServer->renewal_date->copy()
                    : Carbon::now();
                $newRenewalDate = $baseDate->addDays($renewalDays)->toDateTimeString();
            }

            $lockedServer->update([
                'renewal_date' => $newRenewalDate,
                'billing_days' => $resolvedBillingDays,
                'billing_amount' => $order->total,
            ]);

            if ($sourceOrder === null) {
                $order->update([
                    'status' => Order::STATUS_PROCESSED,
                    'fulfillment_claim' => null,
                    'server_id' => $lockedServer->id,
                ]);
            } else {
                if ($order->coupon_id) {
                    CouponUsage::query()
                        ->where('order_id', $order->id)
                        ->where('status', 'reserved')
                        ->update([
                            'status' => 'consumed',
                            'expires_at' => null,
                            'used_at' => now(),
                        ]);
                }

                $order->forceFill([
                    'status' => Order::STATUS_PROCESSED,
                    'server_id' => $lockedServer->id,
                    'fulfillment_claim' => null,
                ])->saveOrFail();
            }

            return ['server' => $lockedServer, 'order' => $order];
        }); // end DB::transaction
    }
}
