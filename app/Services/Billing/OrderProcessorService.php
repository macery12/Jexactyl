<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\CouponUsage;

/**
 * Handles server renewal and coupon recording.
 *
 * New server creation is handled by ServerFulfillmentService.
 */
class OrderProcessorService
{
    public function __construct(
        private ServerRenewalService $renewalService,
    ) {
    }

    /**
     * Process a server renewal.
     *
     * This method handles both free and paid server renewals.
     *
     * @param Server $server The server to renew
     * @param Product $product The product to renew with
     * @param int|null $couponId The coupon ID (optional)
     * @param int $billingDays The billing cycle days (defaults to 30)
     *
     * @return array{server: Server, order: Order}
     */
    public function processRenewal(
        Server $server,
        Product $product,
        ?int $couponId = null,
        int $billingDays = 0,
        ?Order $sourceOrder = null,
    ): array {
        if ($billingDays <= 0) {
            $billingDays = BillingDefaults::defaultBillingDays();
        }
        // Use the unified renewal service
        $result = $this->renewalService->renew($server, $product, $couponId, $billingDays, $sourceOrder);

        // Provider-backed renewals record the original paid order's coupon during
        // fulfillment completion. Free renewals still record their local order here.
        if ($couponId && $sourceOrder === null) {
            $this->recordCouponUsage($couponId, $server->user->id, $result['order']->id);
        }

        return $result;
    }

    /**
     * Record a coupon usage.
     *
     * @param int $couponId The coupon ID
     * @param int $userId The user ID
     * @param int $orderId The order ID
     */
    private function recordCouponUsage(int $couponId, int $userId, int $orderId): void
    {
        CouponUsage::query()
            ->where('coupon_id', $couponId)
            ->where('user_id', $userId)
            ->where('order_id', $orderId)
            ->where('status', 'reserved')
            ->update([
                'status' => 'consumed',
                'expires_at' => null,
                'used_at' => now(),
            ]);
    }
}
