<?php

namespace Everest\Services\Billing;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;

class CheckoutSnapshotService
{
    public function __construct(
        private BillingValidationService $validationService,
        private CheckoutIntegrityService $integrityService,
        private PlanChangeService $planChangeService,
    ) {
    }

    /**
     * Resolve and validate all fulfillment-relevant checkout fields from a request.
     *
     * @return array{locked: bool, attributes: array<string, mixed>, price: array<string, mixed>}
     */
    public function resolve(Request $request, User $user, Product $product, bool $requireComplete): array
    {
        $isRenewal = $request->boolean('renewal', false);
        $isPlanChange = $request->boolean('plan_change', false);
        if ($isRenewal && $isPlanChange) {
            throw new DisplayException('A checkout cannot be both a renewal and a plan change.');
        }

        $serverId = $request->filled('server_id') ? (int) $request->input('server_id') : null;
        $serverName = trim((string) $request->input('name', ''));
        $nodeId = $request->filled('node_id') ? (int) $request->input('node_id') : null;

        $complete = $isRenewal || $isPlanChange
            ? $serverId !== null
            : $serverName !== '' && $nodeId !== null;

        if ($requireComplete && !$complete) {
            throw new DisplayException($isRenewal || $isPlanChange ? 'A server is required to finalize this billing change.' : 'A server name and node are required to finalize this checkout.');
        }

        $server = null;
        $eggId = null;
        $billingDays = (int) ($request->input('billing_days') ?? BillingDefaults::defaultBillingDays());

        $planChangeSnapshot = null;
        $sourceProductId = null;
        if ($complete && ($isRenewal || $isPlanChange)) {
            $server = $user->servers()->findOrFail($serverId);
            if ($isRenewal && (int) $server->billing_product_id !== (int) $product->id) {
                throw new DisplayException('This server does not use the selected product.');
            }
            if ($isRenewal && $server->pending_plan_change_order_id !== null) {
                throw new DisplayException('Finish or cancel the pending paid plan change before renewing this server.');
            }
            if ($isRenewal && $server->scheduled_billing_product_id !== null) {
                throw new DisplayException('Apply or cancel the plan change scheduled for renewal before renewing this server.');
            }

            $nodeId = (int) $server->node_id;
            if (!$request->filled('billing_days') && $server->billing_days) {
                $billingDays = (int) $server->billing_days;
            }
            if ($isPlanChange) {
                if ($request->filled('coupon_id')) {
                    throw new DisplayException('Coupons cannot be applied to a prorated plan change.');
                }
                if (
                    $request->filled('billing_days')
                    && (int) $request->input('billing_days') !== (int) $server->billing_days
                ) {
                    throw new DisplayException('The billing cycle cannot be changed during a plan change.');
                }

                $billingDays = (int) $server->billing_days;
                $quote = $this->planChangeService->quote($server, $product);
                if (($quote['mode'] ?? null) !== 'pay_now' || (int) ($quote['charge_minor'] ?? 0) <= 0) {
                    throw new DisplayException('This plan change does not require immediate payment and must be scheduled instead.');
                }

                $sourceProductId = (int) $server->billing_product_id;
                $planChangeSnapshot = $quote;
                $serverName = 'Prorated Plan Upgrade';
            } else {
                $serverName = 'Server Renewal';
            }
        } elseif ($complete) {
            $this->validationService->validateNodeSelectionForProduct($nodeId, $product);
            $this->validationService->validateNodeDeployment($nodeId, false);

            $requestedEggId = $request->filled('egg_id') ? (int) $request->input('egg_id') : null;
            $eggId = $this->validationService->validateAndGetEggId($product, $requestedEggId);
            $serverId = null;
        } else {
            $serverName = $isRenewal
                ? 'Server Renewal'
                : ($isPlanChange ? 'Prorated Plan Upgrade' : 'Pending Checkout');
            $nodeId = null;
            $serverId = $isRenewal || $isPlanChange ? $serverId : null;
        }

        $couponId = $isPlanChange
            ? null
            : ($request->filled('coupon_id') ? (int) $request->input('coupon_id') : null);
        $orderType = $isRenewal
            ? Order::TYPE_REN
            : ($isPlanChange ? Order::TYPE_UPG : Order::TYPE_NEW);
        if ($isPlanChange && $planChangeSnapshot !== null) {
            $charge = (int) $planChangeSnapshot['charge_minor'] / 100;
            $price = [
                'finalPrice' => $charge,
                'discount' => 0.0,
                'subtotal' => $charge,
                'billingDays' => $billingDays,
                'multiplier' => 1.0,
                'nodeMultiplier' => (float) ($planChangeSnapshot['node_multiplier'] ?? 1.0),
            ];
        } else {
            $price = $this->validationService->calculatePriceWithCoupon(
                $product,
                $couponId,
                $orderType,
                $billingDays,
                $nodeId,
                $user->id
            );
        }

        $variables = $request->input('variables', []);
        $domainPayload = $request->input('domain_payload', []);

        return [
            'locked' => $complete,
            'price' => $price,
            'attributes' => [
                'name' => $serverName,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'type' => $orderType,
                'coupon_id' => $couponId,
                'egg_id' => $eggId,
                'node_id' => $nodeId,
                'server_id' => $serverId,
                'source_product_id' => $sourceProductId,
                'plan_change_snapshot' => $planChangeSnapshot,
                'billing_days' => $billingDays,
                'variables' => is_array($variables) ? $variables : [],
                'domain_payload' => is_array($domainPayload) ? $domainPayload : [],
                'subtotal' => $price['subtotal'],
                'discount' => $price['discount'],
                'total' => $price['finalPrice'],
                'final_price' => $price['finalPrice'],
                'multiplier_used' => $price['multiplier'],
                'node_multiplier_used' => $price['nodeMultiplier'],
            ],
        ];
    }

    public function lock(Order $order, array $snapshot): Order
    {
        $order = $this->integrityService->lock($order, $snapshot['attributes']);

        if ($order->type === Order::TYPE_REN) {
            if ($order->server_id === null) {
                throw new DisplayException('A renewal order must identify a server.');
            }

            $this->planChangeService->assertRenewalAllowed(
                Server::query()->without('allocation')->findOrFail($order->server_id)
            );
        } elseif ($order->type === Order::TYPE_UPG) {
            $this->planChangeService->reservePaidUpgrade(
                $order,
                $order->plan_change_snapshot ?? []
            );
        }

        return $order;
    }

    public function matches(Order $order, array $snapshot): bool
    {
        return $this->integrityService->matches($order, $snapshot['attributes']);
    }

    /**
     * Bind a client idempotency nonce to the exact logical create request
     * without persisting its potentially secret startup variables.
     */
    public function requestFingerprint(
        Request $request,
        User $user,
        Product $product,
        string $processor,
    ): string {
        $payload = [
            'user_id' => (int) $user->id,
            'product_id' => (int) $product->id,
            'processor' => $processor,
            'renewal' => $request->boolean('renewal', false),
            'plan_change' => $request->boolean('plan_change', false),
            'server_id' => $request->filled('server_id') ? (int) $request->input('server_id') : null,
            'node_id' => $request->filled('node_id') ? (int) $request->input('node_id') : null,
            'egg_id' => $request->filled('egg_id') ? (int) $request->input('egg_id') : null,
            'billing_days' => $request->filled('billing_days')
                ? (int) $request->input('billing_days')
                : null,
            'coupon_id' => $request->filled('coupon_id') ? (int) $request->input('coupon_id') : null,
            'name' => trim((string) $request->input('name', '')),
            'variables' => $this->canonicalize($request->input('variables', [])),
            'domain_payload' => $this->canonicalize($request->input('domain_payload', [])),
            'return_url' => $request->input('return_url'),
            'cancel_url' => $request->input('cancel_url'),
        ];

        return hash_hmac(
            'sha256',
            json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            (string) config('app.key')
        );
    }

    /**
     * Resolve the required client idempotency nonce to the one pending checkout
     * it names. A nonce can never be reused for a different processor or logical
     * request.
     */
    public function existingForRequest(
        Request $request,
        User $user,
        Product $product,
        string $processor,
        string $requestFingerprint,
    ): ?Order {
        $nonce = trim((string) $request->input('checkout_nonce', ''));
        if ($nonce === '') {
            throw new DisplayException('A checkout identifier is required. Refresh the checkout page and try again.');
        }

        /** @var Order|null $order */
        $order = Order::query()
            ->where('user_id', $user->id)
            ->where('checkout_nonce', $nonce)
            ->first();
        if ($order === null) {
            return null;
        }

        if (
            $order->payment_processor !== $processor
            || (int) $order->product_id !== (int) $product->id
            || !$order->checkout_request_fingerprint
            || !hash_equals(
                (string) $order->checkout_request_fingerprint,
                $requestFingerprint
            )
        ) {
            throw new DisplayException('This checkout identifier is already bound to different order details.');
        }
        if ($order->status !== Order::STATUS_PENDING) {
            throw new DisplayException('This checkout attempt is no longer pending. Start a new checkout.');
        }
        if (!$order->checkout_locked_at || !$order->checkout_fingerprint) {
            abort(response()->json([
                'error' => 'This checkout is still being initialized. Retry shortly.',
                'error_code' => 'checkout_initializing',
            ], 409));
        }

        return $order;
    }

    private function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }
        if (!array_is_list($value)) {
            ksort($value);
        }
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }
}
