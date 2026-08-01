<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Stripe\StripeClient;
use Everest\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\BillingException;
use Everest\Services\Billing\BillingDefaults;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\StripeCaptureService;
use Everest\Services\Billing\OrderProcessorService;
use Everest\Services\Billing\InvoiceSettingsService;
use Everest\Services\Billing\CheckoutSnapshotService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Transformers\Api\Client\ServerTransformer;
use Everest\Services\Billing\StripeIntentCreationService;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Billing\UpdateCheckoutRequest;
use Everest\Exceptions\Billing\BillingException as BillingExceptionClass;

/**
 * Unified Checkout Controller.
 *
 * Handles both free and paid product purchases and renewals.
 * This controller consolidates billing operations that were previously split
 * between FreeProductController and PaymentController.
 */
class CheckoutController extends ClientApiController
{
    private ?StripeClient $stripe = null;

    public function __construct(
        private BillingValidationService $validationService,
        private OrderProcessorService $processorService,
        private CreateOrderService $orderService,
        private ServerFulfillmentService $fulfillmentService,
        private StripeIntentCreationService $stripeIntentCreationService,
        private InvoiceSettingsService $invoiceSettingsService,
        private CheckoutSnapshotService $snapshotService,
        private CheckoutIntegrityService $integrityService,
        private StripeCaptureService $stripeCaptureService,
    ) {
        parent::__construct();

        // Initialize Stripe client if secret key is configured
        $stripeSecret = Setting::get('settings::modules:billing:keys:secret', config('modules.billing.keys.secret'));
        if ($stripeSecret) {
            try {
                $this->stripe = new StripeClient($stripeSecret);
            } catch (\Exception $e) {
                \Log::error('Failed to initialize Stripe client', [
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Process a free product purchase.
     */
    public function processFree(Request $request): array
    {
        $user = $request->user();
        $product = Product::findOrFail($request->input('product'));

        // Validate billing is enabled
        $this->validationService->validateBillingEnabled();

        // Gate: require billing address when admin has enabled this setting
        $this->assertBillingAddressPresent($user);

        // Get and validate server name
        $serverName = trim((string) $request->input('name', ''));
        if (empty($serverName)) {
            throw new DisplayException('Server name is required.');
        }

        // Get billing days, clamped to a sane range
        $billingDays = max(1, min(365, (int) ($request->input('billing_days') ?? BillingDefaults::defaultBillingDays())));

        // Validate node deployment
        $nodeId = (int) $request->input('node');
        $this->validationService->validateNodeSelectionForProduct($nodeId, $product);
        $this->validationService->validateNodeDeployment($nodeId, true);

        // Calculate price with coupon for new purchase (including node multiplier)
        $couponId = $request->input('coupon_id') ? (int) $request->input('coupon_id') : null;
        $priceInfo = $this->validationService->calculatePriceWithCoupon($product, $couponId, 'new', $billingDays, $nodeId, $user->id);

        // Validate this is a free order
        $this->validationService->validatePriceType($priceInfo['finalPrice'], true);

        // Validate user doesn't already own this free product
        $this->validationService->validateFreeProductOwnership($user->id, $product);

        // Validate and get egg ID
        $requestedEggId = $request->input('egg_id') ? (int) $request->input('egg_id') : null;
        $eggId = $this->validationService->validateAndGetEggId($product, $requestedEggId);

        // Process the order
        $variables = $request->input('variables', []);
        $domainPayload = $request->input('domain_payload', []);
        $result = $this->fulfillmentService->fulfillFreeOrder(
            $request,
            $user,
            $product,
            $nodeId,
            $eggId,
            $couponId,
            $variables,
            null, // No payment intent ID for free orders
            $serverName,
            $billingDays,
            is_array($domainPayload) ? $domainPayload : []
        );

        return $this->fractal->item($result['server'])
            ->transformWith(ServerTransformer::class)
            ->toArray();
    }

    /**
     * Renew a free server.
     */
    public function renewFree(Request $request): array
    {
        $user = $request->user();
        $serverId = (int) $request->input('server_id');
        $product = Product::findOrFail($request->input('product'));

        // Validate billing is enabled
        $this->validationService->validateBillingEnabled();

        // Lookup server scoped to the authenticated user
        $server = $user->servers()->findOrFail($serverId);

        // A free product's renewal duration is authoritative server-side. A
        // paid product made free by a coupon may still select an enabled cycle.
        $billingDays = $product->isFree()
            ? $product->getRenewalDays()
            : (int) ($request->input('billing_days') ?? $server->billing_days ?? BillingDefaults::defaultBillingDays());

        // Calculate price with coupon for renewal (including server's node multiplier)
        $couponId = $request->input('coupon_id') ? (int) $request->input('coupon_id') : null;
        $priceInfo = $this->validationService->calculatePriceWithCoupon($product, $couponId, 'ren', $billingDays, $server->node_id, $user->id);

        // Validate this is a free renewal
        $this->validationService->validatePriceType($priceInfo['finalPrice'], true);

        // Process the renewal
        $result = $this->processorService->processRenewal($server, $product, $couponId, $billingDays);

        return $this->fractal->item($result['server'])
            ->transformWith(ServerTransformer::class)
            ->toArray();
    }

    /**
     * Get Stripe public key.
     *
     * This endpoint is safe to call from the frontend as it only returns
     * the publishable key, which is meant to be public.
     *
     * @param int $id Product ID
     *
     * @throws BillingExceptionClass if publishable key is missing or appears to be a secret key
     */
    public function getStripeKey(Request $request, int $id): JsonResponse
    {
        $publicKey = (string) Setting::get('settings::modules:billing:keys:publishable', config('modules.billing.keys.publishable'));

        if (!$publicKey) {
            throw new BillingExceptionClass('The Stripe Public API key is missing', 'Add the Stripe \'publishable\' key to your billing panel', BillingException::TYPE_STOREFRONT, null, 'stripe', null, ['key_missing' => true]);
        }

        // SECURITY: Verify this is actually a publishable key, not a secret key
        // Publishable keys start with 'pk_', secret keys start with 'sk_'
        if (str_starts_with($publicKey, 'sk_')) {
            // Log this critical security issue
            \Log::critical('SECURITY: Secret key detected in publishable key field!', [
                'detected_type' => 'secret_key',
                'user_id' => $request->user()?->id,
            ]);

            throw new BillingExceptionClass('Critical security error: Secret key in public field', 'A secret key has been detected in the publishable key field. This is a severe security risk. Please reconfigure your Stripe keys immediately with the correct key types.', BillingException::TYPE_STOREFRONT, null, 'stripe', null, ['security_violation' => true]);
        }

        // Verify it looks like a valid Stripe publishable key
        if (!str_starts_with($publicKey, 'pk_')) {
            throw new BillingExceptionClass('Invalid Stripe publishable key format', 'Publishable keys must start with \'pk_test_\' or \'pk_live_\'.', BillingException::TYPE_STOREFRONT, null, 'stripe', null, ['invalid_format' => true]);
        }

        return response()->json(['key' => $publicKey]);
    }

    /**
     * Create a Stripe payment intent.
     *
     * @param int $id Product ID
     *
     * @throws BillingExceptionClass
     */
    public function createIntent(UpdateCheckoutRequest $request, int $id): JsonResponse
    {
        $this->ensureStripeInitialized();

        $product = Product::findOrFail($id);
        $order = null;

        try {
            $this->validationService->validateBillingEnabled();
            $requestFingerprint = $this->snapshotService->requestFingerprint(
                $request,
                $request->user(),
                $product,
                'stripe',
            );
            $existingOrder = $this->snapshotService->existingForRequest(
                $request,
                $request->user(),
                $product,
                'stripe',
                $requestFingerprint,
            );
            if ($existingOrder !== null) {
                return $this->resumeStripeCheckout($existingOrder);
            }

            $snapshot = $this->snapshotService->resolve($request, $request->user(), $product, true);
            $priceInfo = $snapshot['price'];

            // If the coupon makes the order free, skip PaymentIntent creation entirely.
            // Stripe does not allow $0 PaymentIntents; the frontend should route to processFree.
            if ($priceInfo['finalPrice'] <= 0.0001) {
                return response()->json(['free' => true]);
            }

            $this->validationService->validatePriceType($priceInfo['finalPrice'], false);

            $attributes = $snapshot['attributes'];
            try {
                $order = $this->orderService->create(
                    null,
                    $request->user(),
                    $product,
                    Order::STATUS_PENDING,
                    $attributes['type'],
                    $attributes['coupon_id'],
                    $attributes['egg_id'],
                    [
                        'payment_processor' => 'stripe',
                        'billing_days' => $attributes['billing_days'],
                        'name' => $attributes['name'],
                        'node_id' => $attributes['node_id'],
                        'server_id' => $attributes['server_id'],
                        'source_product_id' => $attributes['source_product_id'] ?? null,
                        'plan_change_snapshot' => $attributes['plan_change_snapshot'] ?? null,
                        'variables' => $attributes['variables'],
                        'domain_payload' => $attributes['domain_payload'],
                        'multiplier_used' => $attributes['multiplier_used'],
                        'node_multiplier_used' => $attributes['node_multiplier_used'],
                        'checkout_nonce' => $request->input('checkout_nonce'),
                        'checkout_request_fingerprint' => $requestFingerprint,
                    ],
                    $priceInfo['finalPrice'],
                    $priceInfo['subtotal'],
                    $priceInfo['discount'],
                    fn (Order $created): Order => $this->snapshotService->lock($created, $snapshot),
                );
            } catch (DisplayException $exception) {
                $existingOrder = $this->snapshotService->existingForRequest(
                    $request,
                    $request->user(),
                    $product,
                    'stripe',
                    $requestFingerprint,
                );
                if ($existingOrder !== null) {
                    return $this->resumeStripeCheckout($existingOrder);
                }

                throw $exception;
            }

            return $this->createAndAttachStripeIntent($order, $request->user());
        } catch (BillingExceptionClass $e) {
            throw $e;
        } catch (DisplayException $e) {
            throw $e;
        } catch (\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {
            throw $e;
        } catch (\Stripe\Exception\ApiErrorException $e) {
            \Log::error('Stripe payment intent creation failed', [
                'product_id' => $product->id,
                'error' => $e->getMessage(),
                'stripe_code' => $e->getStripeCode(),
            ]);

            throw new BillingExceptionClass('Stripe payment intent creation failed', 'Failed to create payment intent: ' . $e->getMessage() . '. Please check your payment details and try again.', BillingException::TYPE_PAYMENT, null, 'stripe', null, ['product_id' => $product->id, 'stripe_error' => $e->getStripeCode()], $e);
        } catch (\Exception $e) {
            \Log::error('Payment intent creation exception', [
                'product_id' => $product->id,
                'error' => $e->getMessage(),
            ]);

            throw new BillingExceptionClass('Payment intent creation error', 'An unexpected error occurred while creating payment intent: ' . $e->getMessage(), BillingException::TYPE_PAYMENT, null, 'stripe', null, ['product_id' => $product->id, 'error' => $e->getMessage()], $e);
        }
    }

    /**
     * Update a payment intent with order details.
     *
     * @param int|null $id Product ID
     *
     * @throws BillingExceptionClass
     */
    public function updateIntent(UpdateCheckoutRequest $request, ?int $id = null): Response
    {
        $this->ensureStripeInitialized();

        $product = Product::findOrFail($id);

        try {
            $this->validationService->validateBillingEnabled();
            $snapshot = $this->snapshotService->resolve($request, $request->user(), $product, true);
            $priceInfo = $snapshot['price'];

            if ($priceInfo['finalPrice'] <= 0.0001) {
                throw new DisplayException('This order is free due to the applied coupon. Please use the free checkout instead of payment.');
            }
            $this->validationService->validatePriceType($priceInfo['finalPrice'], false);

            $intentId = (string) $request->input('intent');
            /** @var PaymentTransaction $transaction */
            $transaction = PaymentTransaction::query()
                ->where('processor', 'stripe')
                ->where('external_id', $intentId)
                ->firstOrFail();
            $order = $transaction->order;
            abort_if($order->user_id !== $request->user()->id, 403);
            abort_if((int) $order->product_id !== (int) $product->id, 404);

            $intent = $this->stripe->paymentIntents->retrieve($intentId);
            if (!in_array((string) ($intent->status ?? ''), ['requires_payment_method', 'requires_confirmation'], true)) {
                throw new DisplayException('This payment intent can no longer be changed.');
            }

            if ($order->status !== Order::STATUS_PENDING) {
                throw new DisplayException('This checkout can no longer be changed.');
            }

            if (!$this->snapshotService->matches($order, $snapshot)) {
                throw new DisplayException('This checkout is locked to different order details.');
            }

            // Compatibility endpoint: finalized checkouts are immutable. Verify
            // the caller and provider snapshot, but never mutate provider money.
            $this->integrityService->assertStripeIntent($order, $transaction, $intent);

            return $this->returnNoContent();
        } catch (BillingExceptionClass|DisplayException|\Illuminate\Database\Eloquent\ModelNotFoundException|\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {
            throw $e;
        } catch (\Stripe\Exception\ApiErrorException $e) {
            \Log::error('Stripe intent update failed', [
                'intent_id' => $request->input('intent'),
                'error' => $e->getMessage(),
                'stripe_code' => $e->getStripeCode(),
            ]);

            throw new BillingExceptionClass('Stripe payment intent update failed', 'Failed to update payment intent: ' . $e->getMessage() . '. Please try again.', BillingException::TYPE_PAYMENT, null, 'stripe', $request->input('intent'), ['stripe_error' => $e->getStripeCode()], $e);
        } catch (\Exception $e) {
            \Log::error('Payment intent update exception', [
                'intent_id' => $request->input('intent'),
                'error' => $e->getMessage(),
            ]);

            throw new BillingExceptionClass('Payment intent update error', 'An unexpected error occurred while updating payment intent: ' . $e->getMessage(), BillingException::TYPE_PAYMENT, null, 'stripe', $request->input('intent'), ['error' => $e->getMessage()], $e);
        }
    }

    /**
     * Process a paid order.
     *
     * @throws BillingExceptionClass
     */
    public function processPaid(UpdateCheckoutRequest $request): Response
    {
        $this->ensureStripeInitialized();
        $order = null;

        try {
            $intentId = (string) $request->input('intent');
            $transaction = PaymentTransaction::where('processor', 'stripe')
                ->where('external_id', $intentId)
                ->firstOrFail();
            $order = $transaction->order;
            abort_if($order->user_id !== $request->user()->id, 403);

            if ($order->status === Order::STATUS_PROCESSED) {
                return $this->returnNoContent();
            }

            $intent = $this->stripe->paymentIntents->retrieve($intentId);

            // Validate billing is enabled
            $this->validationService->validateBillingEnabled();

            // Gate: require billing address when admin has enabled this setting
            $this->assertBillingAddressPresent($request->user());

            if (!$intent) {
                throw new BillingExceptionClass('Unable to fetch PaymentIntent', 'Unable to fetch payment intent from Stripe. Please try again or contact support.', BillingException::TYPE_PAYMENT, $order->id, 'stripe', $intentId, ['intent_id' => $intentId]);
            }

            if (!in_array($intent->status, ['requires_capture', 'succeeded'], true)) {
                throw new BillingExceptionClass('Payment not ready for capture', 'The payment was not successful or is not ready to be captured. Status: ' . $intent->status, BillingException::TYPE_PAYMENT, $order->id, 'stripe', $intent->id, ['intent_status' => $intent->status]);
            }

            $this->integrityService->assertStripeIntent($order, $transaction, $intent);

            $this->fulfillmentService->fulfillStripeOrder(
                $request,
                $order,
                function () use ($intent, $order, $transaction): void {
                    $capturedIntent = $intent->status === 'requires_capture'
                        ? $intent->capture(
                            [],
                            ['idempotency_key' => 'capture-order-' . $order->id]
                        )
                        : $intent;

                    $this->stripeCaptureService->record($order, $transaction, $capturedIntent);
                },
                $intent->status === 'succeeded',
            );

            return $this->returnNoContent();
        } catch (BillingExceptionClass|DisplayException|\Illuminate\Database\Eloquent\ModelNotFoundException|\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {
            throw $e;
        } catch (\Stripe\Exception\ApiErrorException $e) {
            \Log::error('Stripe order processing failed', [
                'intent_id' => $request->input('intent'),
                'error' => $e->getMessage(),
                'stripe_code' => $e->getStripeCode(),
            ]);

            throw new BillingExceptionClass('Stripe order processing failed', 'Failed to process order: ' . $e->getMessage() . '. Please contact support.', BillingException::TYPE_PAYMENT, $order?->id, 'stripe', $request->input('intent'), ['stripe_error' => $e->getStripeCode()], $e);
        } catch (\Exception $e) {
            \Log::error('Order processing exception', [
                'intent_id' => $request->input('intent'),
                'error' => $e->getMessage(),
            ]);

            throw new BillingExceptionClass('Order processing error', 'An unexpected error occurred while processing your order: ' . $e->getMessage(), BillingException::TYPE_PAYMENT, $order?->id, 'stripe', $request->input('intent'), ['error' => $e->getMessage()], $e);
        }
    }

    /**
     * Throw a 422 if the admin requires a billing address and the user hasn't set one.
     */
    private function assertBillingAddressPresent(\Everest\Models\User $user): void
    {
        $settings = $this->invoiceSettingsService->get();

        if (!$settings->require_billing_address) {
            return;
        }

        $profile = $user->billingProfile;
        $data = is_array($profile?->encrypted_data) ? $profile->encrypted_data : [];
        $required = ['first_name', 'last_name', 'address_line1', 'city', 'state', 'postal_code', 'country'];

        $isComplete = $profile !== null && collect($required)->every(function (string $field) use ($data): bool {
            $value = $data[$field] ?? null;

            return is_string($value) && trim($value) !== '';
        });

        if (!$isComplete) {
            abort(response()->json([
                'error'      => 'A valid billing address is required to complete checkout.',
                'error_code' => 'billing_address_required',
            ], 422));
        }
    }

    private function resumeStripeCheckout(Order $order): JsonResponse
    {
        /** @var PaymentTransaction|null $transaction */
        $transaction = $order->transaction()->first();
        if ($transaction === null) {
            throw new DisplayException('The existing checkout has no payment ledger.');
        }
        if (!$transaction->external_id) {
            $user = $order->user;
            if ($user === null) {
                throw new DisplayException('The checkout owner no longer exists.');
            }

            return $this->createAndAttachStripeIntent($order, $user);
        }

        $intent = $this->stripe->paymentIntents->retrieve($transaction->external_id);
        if (!$intent->client_secret) {
            throw new DisplayException('The existing payment intent is unavailable.');
        }
        $this->integrityService->assertStripeIntent($order, $transaction, $intent);
        if (($intent->status ?? null) === 'canceled') {
            throw new DisplayException('The existing payment intent was cancelled.');
        }
        $this->assertCheckoutStillPending($order);
        $lockedAmount = $this->lockedCheckoutAmount($order);

        return response()->json([
            'id' => $intent->id,
            'secret' => $intent->client_secret,
            'amount_minor' => $lockedAmount['amount_minor'],
            'currency' => $lockedAmount['currency'],
        ]);
    }

    private function createAndAttachStripeIntent(
        Order $order,
        \Everest\Models\User $user,
    ): JsonResponse {
        $intentParams = $this->stripeIntentCreationService->parameters($order, $user);

        $paymentIntent = $this->stripe->paymentIntents->create(
            $intentParams,
            ['idempotency_key' => 'checkout-order-' . $order->id]
        );
        if (!$paymentIntent->client_secret) {
            throw new BillingExceptionClass('PaymentIntent client secret not generated', 'The payment intent was created but no client secret was returned.', BillingException::TYPE_PAYMENT, $order->id, 'stripe', $paymentIntent->id ?? null);
        }
        $providerCustomerId = $paymentIntent->customer ?? null;
        if (is_object($providerCustomerId)) {
            $providerCustomerId = $providerCustomerId->id ?? null;
        }
        $providerCustomerId = $providerCustomerId ?: null;

        DB::transaction(function () use ($order, $paymentIntent, $providerCustomerId): void {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction $transaction */
            $transaction = PaymentTransaction::query()
                ->where('order_id', $lockedOrder->id)
                ->lockForUpdate()
                ->firstOrFail();

            if (
                $lockedOrder->status !== Order::STATUS_PENDING
                || !hash_equals(
                    (string) $order->checkout_request_fingerprint,
                    (string) $lockedOrder->checkout_request_fingerprint
                )
                || !hash_equals(
                    (string) $order->checkout_fingerprint,
                    (string) $lockedOrder->checkout_fingerprint
                )
                || ($lockedOrder->payment_intent_id && $lockedOrder->payment_intent_id !== $paymentIntent->id)
                || ($transaction->external_id && $transaction->external_id !== $paymentIntent->id)
                || (
                    $transaction->provider_customer_id
                    && $transaction->provider_customer_id !== $providerCustomerId
                )
            ) {
                throw new DisplayException('This checkout can no longer accept a payment intent.');
            }

            $lockedOrder->forceFill(['payment_intent_id' => $paymentIntent->id])->saveOrFail();
            if (!$transaction->external_id) {
                $transaction->forceFill([
                    'external_id' => $paymentIntent->id,
                    'provider_customer_id' => $providerCustomerId,
                ])->saveOrFail();
            } elseif (!$transaction->provider_customer_id && $providerCustomerId) {
                $transaction->forceFill([
                    'provider_customer_id' => $providerCustomerId,
                ])->saveOrFail();
            }
        });

        /** @var PaymentTransaction $transaction */
        $transaction = $order->transaction()->firstOrFail();
        $this->integrityService->assertStripeIntent($order, $transaction, $paymentIntent);
        $this->assertCheckoutStillPending($order);
        $lockedAmount = $this->lockedCheckoutAmount($order);

        return response()->json([
            'id' => $paymentIntent->id,
            'secret' => $paymentIntent->client_secret,
            'amount_minor' => $lockedAmount['amount_minor'],
            'currency' => $lockedAmount['currency'],
        ]);
    }

    /**
     * @return array{amount_minor: int, currency: string}
     */
    private function lockedCheckoutAmount(Order $order): array
    {
        return DB::transaction(function () use ($order): array {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            if (
                $lockedOrder->status !== Order::STATUS_PENDING
                || $lockedOrder->checkout_amount_minor === null
                || !$lockedOrder->checkout_currency
            ) {
                throw new DisplayException('This checkout no longer has a payable locked amount.');
            }

            return [
                'amount_minor' => (int) $lockedOrder->checkout_amount_minor,
                'currency' => strtoupper((string) $lockedOrder->checkout_currency),
            ];
        });
    }

    private function assertCheckoutStillPending(Order $order): void
    {
        if (
            !Order::query()
                ->whereKey($order->id)
                ->where('status', Order::STATUS_PENDING)
                ->where('checkout_nonce', $order->checkout_nonce)
                ->where('checkout_request_fingerprint', $order->checkout_request_fingerprint)
                ->where('checkout_fingerprint', $order->checkout_fingerprint)
                ->exists()
        ) {
            throw new DisplayException('This checkout is no longer pending.');
        }
    }

    /**
     * Ensure Stripe client is initialized.
     *
     * @throws BillingExceptionClass if Stripe is not configured
     */
    private function ensureStripeInitialized(): void
    {
        if (!$this->stripe) {
            throw new BillingExceptionClass('Stripe is not configured', 'Stripe payment processing is not configured. Please contact support or try a different payment method.', BillingException::TYPE_STOREFRONT, null, 'stripe', null, ['configured' => false]);
        }
    }
}
