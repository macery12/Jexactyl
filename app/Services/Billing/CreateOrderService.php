<?php

namespace Everest\Services\Billing;

use Everest\Models\User;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\PaymentTransaction;

class CreateOrderService
{
    private const FREE_ORDER_EPSILON = 0.0001;

    /**
     * Process the creation of an order.
     *
     * When $preCalculatedTotal / $preCalculatedSubtotal / $preCalculatedDiscount are
     * supplied (e.g. from a controller that already called calculatePriceWithCoupon()),
     * those values are used directly and the internal price recalculation is skipped.
     */
    public function create(
        ?string $intent,
        User $user,
        Product $product,
        ?string $status,
        ?string $type,
        ?int $couponId = null,
        ?int $eggId = null,
        array $additionalData = [],
        ?float $preCalculatedTotal = null,
        ?float $preCalculatedSubtotal = null,
        ?float $preCalculatedDiscount = null,
    ): Order {
        $order = new Order();
        $uuid = uuid_create();

        // Get billing days from additional data or default from settings
        $billingDays = $additionalData['billing_days'] ?? BillingDefaults::defaultBillingDays();

        // Get node ID for location-based pricing
        $nodeId = $additionalData['node_id'] ?? null;

        if ($preCalculatedTotal !== null) {
            // Use the pre-validated price from the controller — avoids double-calculation
            $subtotal = $preCalculatedSubtotal ?? $preCalculatedTotal;
            $discount = $preCalculatedDiscount ?? 0.0;
            $total = $preCalculatedTotal;
            $multiplierUsed = 1.0;
            $nodeMultiplierUsed = 1.0;
        } else {
            // Calculate price based on billing cycle and node
            $priceInfo = $product->calculatePrice($billingDays, $nodeId);
            $subtotal = $priceInfo['price'];
            $multiplierUsed = $priceInfo['multiplier'];
            $nodeMultiplierUsed = $priceInfo['node_multiplier'];

            $discount = 0;
            $total = $subtotal;

            // Apply coupon if provided
            if ($couponId) {
                $coupon = \Everest\Models\Billing\Coupon::find($couponId);
                if ($coupon) {
                    $discount = $coupon->calculateDiscount($subtotal);
                    $total = max(0, $subtotal - $discount);
                }
            }
        }

        $order->name = $additionalData['name'] ?? $uuid;
        $order->payment_intent_id = $intent; // null for free orders
        $order->user_id = $user->id;
        $order->description = substr($uuid, 0, 8) . ' - Order for ' . $product->name . ' by ' . $user->email;
        $order->subtotal = $subtotal;
        $order->discount = $discount;
        $order->total = $total;
        $order->billing_days = $billingDays;
        $order->final_price = $total;
        $order->multiplier_used = $multiplierUsed;
        $order->node_multiplier_used = $nodeMultiplierUsed;
        $order->status = $status ?? Order::STATUS_EXPIRED;
        $order->product_id = $product->id;
        $order->product_name = $product->name;
        $order->coupon_id = $couponId;
        $order->egg_id = $eggId;
        $order->node_id = $nodeId;
        $order->server_id = $additionalData['server_id'] ?? null;
        $order->variables = $additionalData['variables'] ?? null;
        $order->domain_payload = $additionalData['domain_payload'] ?? null;
        $order->type = $type;
        $paymentProcessor = $additionalData['payment_processor'] ?? null;
        if ($paymentProcessor === null) {
            $paymentProcessor = ($intent === null || $total <= self::FREE_ORDER_EPSILON) ? 'free' : 'stripe';
        }

        $order->payment_processor = $paymentProcessor;
        $order->paypal_order_id = $additionalData['paypal_order_id'] ?? null;
        $order->payment_token = $additionalData['payment_token'] ?? null;

        $order->saveOrFail();

        // Write a PaymentTransaction record for every non-free order so that
        // payment_transactions is the authoritative lookup table (phase 5.4).
        if ($paymentProcessor !== 'free') {
            $transactionData = [
                'order_id'  => $order->id,
                'processor' => $paymentProcessor,
                // Status is null at creation time; updated to final value when
                // the processor confirms or captures the payment.
                'status' => null,
            ];

            if ($paymentProcessor === 'stripe') {
                $transactionData['external_id'] = $intent;
            } elseif ($paymentProcessor === 'paypal') {
                $transactionData['external_id']   = $additionalData['paypal_order_id'] ?? null;
                $transactionData['payment_token'] = $additionalData['payment_token'] ?? null;
            }

            PaymentTransaction::create($transactionData);
        }

        return $order;
    }
}
