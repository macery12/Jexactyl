<?php

namespace Everest\Services\Billing;

use Everest\Models\User;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Coupon;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\CouponUsage;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Models\Billing\FreeProductEntitlement;
use Illuminate\Database\UniqueConstraintViolationException;

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
        ?callable $afterCreate = null,
    ): Order {
        $order = new Order();
        $uuid = uuid_create();
        $expectsFreeProduct = $product->isFree();

        // Get billing days from additional data or default from settings
        $billingDays = $additionalData['billing_days'] ?? BillingDefaults::defaultBillingDays();

        // Get node ID for location-based pricing
        $nodeId = $additionalData['node_id'] ?? null;

        if ($preCalculatedTotal !== null) {
            // Use the pre-validated price from the controller — avoids double-calculation
            $subtotal = $preCalculatedSubtotal ?? $preCalculatedTotal;
            $discount = $preCalculatedDiscount ?? 0.0;
            $total = $preCalculatedTotal;
            $multiplierUsed = (float) ($additionalData['multiplier_used'] ?? 1.0);
            $nodeMultiplierUsed = (float) ($additionalData['node_multiplier_used'] ?? 1.0);
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
                $coupon = Coupon::find($couponId);
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
        $order->requires_free_product_entitlement = $expectsFreeProduct && $type === Order::TYPE_NEW;
        $order->product_name = $product->name;
        $order->coupon_id = $couponId;
        $order->egg_id = $eggId;
        $order->node_id = $nodeId;
        $order->server_id = $additionalData['server_id'] ?? null;
        if (array_key_exists('source_product_id', $additionalData)) {
            $order->source_product_id = $additionalData['source_product_id'];
        }
        if (array_key_exists('plan_change_snapshot', $additionalData)) {
            $order->plan_change_snapshot = $additionalData['plan_change_snapshot'];
        }
        $order->variables = $additionalData['variables'] ?? null;
        $order->domain_payload = $additionalData['domain_payload'] ?? null;
        $order->type = $type;
        $paymentProcessor = $additionalData['payment_processor'] ?? null;
        if ($paymentProcessor === null) {
            $paymentProcessor = ($intent === null || $total <= self::FREE_ORDER_EPSILON) ? 'free' : 'stripe';
        }

        $order->payment_processor = $paymentProcessor;
        $order->checkout_nonce = $additionalData['checkout_nonce'] ?? null;
        $order->checkout_request_fingerprint = $additionalData['checkout_request_fingerprint'] ?? null;
        $order->paypal_order_id = $additionalData['paypal_order_id'] ?? null;
        $order->payment_token = $additionalData['payment_token'] ?? null;

        try {
            DB::transaction(function () use ($order, $paymentProcessor, $intent, $additionalData, $product, $expectsFreeProduct, $user, $couponId, $subtotal, $type, $afterCreate): void {
                /** @var Product $lockedProduct */
                $lockedProduct = Product::query()
                    ->whereKey($product->id)
                    ->lockForUpdate()
                    ->firstOrFail();
                if ($lockedProduct->isFree() !== $expectsFreeProduct) {
                    throw new DisplayException('This product changed between free and paid while checkout was being prepared. Refresh and try again.');
                }

                if ($couponId !== null) {
                    /** @var Coupon $coupon */
                    $coupon = Coupon::query()->whereKey($couponId)->lockForUpdate()->firstOrFail();
                    $validation = $coupon->canBeReserved($user->id, (float) $subtotal);
                    if (!$validation['valid'] || !$coupon->isAllowedForOrderType($type)) {
                        throw new DisplayException($validation['valid'] ? 'This coupon is not valid for this order type.' : $validation['message']);
                    }
                }

                $order->saveOrFail();

                if ($couponId !== null) {
                    CouponUsage::query()->create([
                        'coupon_id' => $couponId,
                        'user_id' => $user->id,
                        'order_id' => $order->id,
                        'status' => 'reserved',
                        'used_at' => now(),
                        'expires_at' => now()->addDay(),
                    ]);
                }

                if ($lockedProduct->isFree() && $type === Order::TYPE_NEW) {
                    FreeProductEntitlement::query()->create([
                        'user_id' => $user->id,
                        'product_id' => $lockedProduct->id,
                        'order_id' => $order->id,
                        'status' => 'reserved',
                        'expires_at' => now()->addDay(),
                    ]);
                }

                // Every provider-backed order receives exactly one ledger row,
                // before the external provider identifier exists.
                if ($paymentProcessor !== 'free') {
                    $transactionData = [
                        'order_id'  => $order->id,
                        'processor' => $paymentProcessor,
                        'status' => null,
                        'provider_customer_id' => $additionalData['provider_customer_id'] ?? null,
                    ];

                    if ($paymentProcessor === 'stripe') {
                        $transactionData['external_id'] = $intent;
                    } elseif ($paymentProcessor === 'paypal') {
                        $transactionData['external_id']   = $additionalData['paypal_order_id'] ?? null;
                        $transactionData['payment_token'] = $additionalData['payment_token'] ?? null;
                    }

                    PaymentTransaction::create($transactionData);
                }

                // Provider-backed controllers use this hook to persist the
                // immutable checkout snapshot in the same commit as the order,
                // reservations, and payment ledger. No same-nonce retry can
                // observe a permanently half-initialized checkout after a crash.
                if ($afterCreate !== null) {
                    $afterCreate($order);
                }
            });
        } catch (UniqueConstraintViolationException $exception) {
            throw new DisplayException('This checkout conflicts with an entitlement or payment already reserved.');
        }

        return $order;
    }
}
