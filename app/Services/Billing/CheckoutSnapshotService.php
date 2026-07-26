<?php

namespace Everest\Services\Billing;

use Everest\Models\User;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;

class CheckoutSnapshotService
{
    public function __construct(
        private BillingValidationService $validationService,
        private CheckoutIntegrityService $integrityService,
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
        $serverId = $request->filled('server_id') ? (int) $request->input('server_id') : null;
        $serverName = trim((string) $request->input('name', ''));
        $nodeId = $request->filled('node_id') ? (int) $request->input('node_id') : null;

        $complete = $isRenewal
            ? $serverId !== null
            : $serverName !== '' && $nodeId !== null;

        if ($requireComplete && !$complete) {
            throw new DisplayException($isRenewal ? 'A server is required to finalize this renewal.' : 'A server name and node are required to finalize this checkout.');
        }

        $server = null;
        $eggId = null;
        $billingDays = (int) ($request->input('billing_days') ?? BillingDefaults::defaultBillingDays());

        if ($complete && $isRenewal) {
            $server = $user->servers()->findOrFail($serverId);
            if ((int) $server->billing_product_id !== (int) $product->id) {
                throw new DisplayException('This server does not use the selected product.');
            }

            $nodeId = (int) $server->node_id;
            if (!$request->filled('billing_days') && $server->billing_days) {
                $billingDays = (int) $server->billing_days;
            }
            $serverName = 'Server Renewal';
        } elseif ($complete) {
            $this->validationService->validateNodeSelectionForProduct($nodeId, $product);
            $this->validationService->validateNodeDeployment($nodeId, false);

            $requestedEggId = $request->filled('egg_id') ? (int) $request->input('egg_id') : null;
            $eggId = $this->validationService->validateAndGetEggId($product, $requestedEggId);
            $serverId = null;
        } else {
            $serverName = $isRenewal ? 'Server Renewal' : 'Pending Checkout';
            $nodeId = null;
            $serverId = $isRenewal ? $serverId : null;
        }

        $couponId = $request->filled('coupon_id') ? (int) $request->input('coupon_id') : null;
        $orderType = $isRenewal ? Order::TYPE_REN : Order::TYPE_NEW;
        $price = $this->validationService->calculatePriceWithCoupon(
            $product,
            $couponId,
            $orderType,
            $billingDays,
            $nodeId,
            $user->id
        );

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
        return $this->integrityService->lock($order, $snapshot['attributes']);
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
     * Resolve an optional client idempotency nonce to the one pending checkout
     * it names. A nonce can never be reused for a different processor or
     * logical request.
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
            return null;
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
