<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
use Everest\Models\Billing\Order;
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
    ): array {
        if ($billingDays <= 0) {
            $billingDays = BillingDefaults::defaultBillingDays();
        }
        // Use the unified renewal service
        $result = $this->renewalService->renew($server, $product, $couponId, $billingDays);

        // Record coupon usage if applicable
        if ($couponId) {
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
        CouponUsage::firstOrCreate(
            [
                'coupon_id' => $couponId,
                'user_id' => $userId,
                'order_id' => $orderId,
            ],
            ['used_at' => now()]
        );
    }
}
