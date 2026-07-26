<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\RedirectResponse;
use Everest\Exceptions\DisplayException;
use Everest\Traits\ValidatesRedirectUrl;
use Everest\Services\Security\LogSanitizer;
use Everest\Models\Billing\BillingException;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\PayPalCaptureService;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\InvoiceSettingsService;
use Everest\Services\Billing\CheckoutSnapshotService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\CheckoutReservationService;
use Everest\Services\Billing\PayPalOrderCreationService;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Billing\UpdateCheckoutRequest;
use Everest\Exceptions\Billing\BillingException as BillingExceptionClass;

class PayPalCheckoutController extends ClientApiController
{
    use ValidatesRedirectUrl;

    public function __construct(
        private PayPalPaymentService $paypalService,
        private BillingValidationService $validationService,
        private CreateOrderService $orderService,
        private ServerFulfillmentService $fulfillmentService,
        private CheckoutSnapshotService $snapshotService,
        private CheckoutIntegrityService $integrityService,
        private PayPalCaptureService $captureService,
        private InvoiceSettingsService $invoiceSettingsService,
        private CheckoutReservationService $reservationService,
        private PayPalOrderCreationService $paypalOrderCreationService,
    ) {
        parent::__construct();
    }

    /**
     * Create a PayPal order.
     *
     * @param int $id Product ID
     */
    public function createOrder(UpdateCheckoutRequest $request, int $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $order = null;

        $this->validationService->validateBillingEnabled();
        $this->assertBillingAddressPresent($request->user());
        $requestFingerprint = $this->snapshotService->requestFingerprint(
            $request,
            $request->user(),
            $product,
            'paypal',
        );
        $existingOrder = $this->snapshotService->existingForRequest(
            $request,
            $request->user(),
            $product,
            'paypal',
            $requestFingerprint,
        );
        if ($existingOrder !== null) {
            return $this->resumePayPalCheckout($request, $existingOrder);
        }

        $snapshot = $this->snapshotService->resolve($request, $request->user(), $product, true);
        $attributes = $snapshot['attributes'];
        $priceInfo = $snapshot['price'];

        // If the coupon makes the order free, skip PayPal order creation entirely.
        // The frontend should route to processFree when total is $0.
        if ($priceInfo['finalPrice'] <= 0.0001) {
            return response()->json(['free' => true]);
        }

        $this->validationService->validatePriceType($priceInfo['finalPrice'], false);

        // Generate a secure random token for order tracking
        $token = \Illuminate\Support\Str::uuid()->toString();

        $orderData = [
            'payment_processor' => 'paypal',
            'payment_token' => $token,
            'name' => $attributes['name'],
            'node_id' => $attributes['node_id'],
            'server_id' => $attributes['server_id'],
            'billing_days' => $attributes['billing_days'],
            'variables' => $attributes['variables'],
            'domain_payload' => $attributes['domain_payload'],
            'multiplier_used' => $attributes['multiplier_used'],
            'node_multiplier_used' => $attributes['node_multiplier_used'],
            'checkout_nonce' => $request->input('checkout_nonce'),
            'checkout_request_fingerprint' => $requestFingerprint,
        ];

        // Persist the local authority before creating the provider order.
        try {
            $order = $this->orderService->create(
                null, // PayPal doesn't use payment_intent_id
                $request->user(),
                $product,
                Order::STATUS_PENDING,
                $attributes['type'],
                $attributes['coupon_id'],
                $attributes['egg_id'],
                $orderData,
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
                'paypal',
                $requestFingerprint,
            );
            if ($existingOrder !== null) {
                return $this->resumePayPalCheckout($request, $existingOrder);
            }

            throw $exception;
        }

        return $this->createAndAttachPayPalOrder($request, $order);
    }

    /**
     * Safely redirect the user to PayPal after validating the approval URL.
     */
    public function redirectToApproval(Request $request, string $orderId): RedirectResponse
    {
        // Authorization guard: ensure the order belongs to the current user before redirecting.
        $transaction = PaymentTransaction::where('processor', 'paypal')
            ->where('external_id', $orderId)
            ->firstOrFail();
        $order = $transaction->order;
        abort_if($order->user_id !== $request->user()->id, 403);
        if ($order->status !== Order::STATUS_PENDING) {
            throw new DisplayException('This checkout is no longer pending.');
        }

        $paypalOrder = $this->paypalService->getOrder($orderId);
        $this->integrityService->assertPayPalOrder($order, $transaction, $paypalOrder);
        $approvalUrl = $this->paypalService->getApprovalUrl($paypalOrder);

        if (!$approvalUrl) {
            throw new DisplayException('PayPal approval URL unavailable.');
        }

        $safeUrl = $this->validateRedirectUrl($approvalUrl, ['paypal.com']);

        return redirect()->away($safeUrl);
    }

    /**
     * Update a PayPal order with details.
     *
     * @param int $id Product ID
     */
    public function updateOrder(UpdateCheckoutRequest $request, int $id): Response
    {
        $product = Product::findOrFail($id);
        $paypalOrderId = (string) $request->input('order_id');

        $this->validationService->validateBillingEnabled();
        $snapshot = $this->snapshotService->resolve($request, $request->user(), $product, true);
        $this->validationService->validatePriceType($snapshot['price']['finalPrice'], false);

        $transaction = PaymentTransaction::where('processor', 'paypal')
            ->where('external_id', $paypalOrderId)
            ->firstOrFail();
        $order = $transaction->order;
        abort_if($order->user_id !== $request->user()->id, 403);
        abort_if((int) $order->product_id !== (int) $product->id, 404);

        $providerOrder = $this->paypalService->getOrder($paypalOrderId);
        if (!in_array((string) ($providerOrder['status'] ?? ''), ['CREATED', 'SAVED', 'PAYER_ACTION_REQUIRED'], true)) {
            throw new DisplayException('This PayPal order can no longer be changed.');
        }

        if ($order->status !== Order::STATUS_PENDING) {
            throw new DisplayException('This checkout can no longer be changed.');
        }

        if (!$this->snapshotService->matches($order, $snapshot)) {
            throw new DisplayException('This checkout is locked to different order details.');
        }

        $providerOrder = $this->paypalService->getOrder($paypalOrderId);
        $this->integrityService->assertPayPalOrder($order, $transaction, $providerOrder);

        Log::info('PayPal order updated successfully', [
            'order_id' => $order->id,
            'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
        ]);

        return $this->returnNoContent();
    }

    /**
     * Capture a PayPal order after customer approval.
     *
     * @throws BillingExceptionClass
     */
    public function captureOrder(UpdateCheckoutRequest $request): JsonResponse
    {
        $paypalOrderId = $request->input('order_id');

        Log::info('PayPal capture requested', [
            'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
            'user_id' => $request->user()->id,
        ]);

        if (!$paypalOrderId) {
            Log::error('PayPal capture failed: No order ID provided');
            throw new BillingExceptionClass('PayPal order ID missing', 'PayPal order ID is required to capture payment.', BillingException::TYPE_VALIDATION, null, 'paypal', null, ['user_id' => $request->user()->id]);
        }

        try {
            /** @var PaymentTransaction $tx */
            $tx = PaymentTransaction::where('processor', 'paypal')
                ->where('external_id', $paypalOrderId)
                ->firstOrFail();
            $order = $tx->order;
            abort_if($order->user_id !== $request->user()->id, 403);

            Log::info('Found order for capture', [
                'order_id' => $order->id,
                'order_status' => $order->status,
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
            ]);

            if ($order->status === Order::STATUS_PROCESSED) {
                Log::info('Order already processed, returning success', ['order_id' => $order->id]);

                return response()->json([
                    'success' => true,
                    'message' => 'Order already processed',
                    'order_id' => $order->id,
                ]);
            }

            $this->validationService->validateBillingEnabled();

            $providerOrder = $this->paypalService->getOrder($paypalOrderId);
            $this->integrityService->assertPayPalOrder($order, $tx, $providerOrder);
            $providerStatus = (string) ($providerOrder['status'] ?? '');

            Log::info('PayPal order provider status', [
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'status' => $providerStatus,
            ]);

            if (!in_array($providerStatus, ['APPROVED', 'COMPLETED'], true)) {
                throw new BillingExceptionClass('PayPal order not approved', 'PayPal order is not ready to be captured.', BillingException::TYPE_PAYMENT, $order->id, 'paypal', $paypalOrderId, ['order_status' => $providerStatus]);
            }

            // The fulfillment service claims pending -> fulfilling before this
            // callback can capture, making capture and cancellation mutually exclusive.
            $this->fulfillmentService->fulfillPayPalOrder(
                $request,
                $order,
                function () use ($providerStatus, $providerOrder, $paypalOrderId, $order, $tx): void {
                    $captureResult = $providerStatus === 'APPROVED'
                        ? $this->paypalService->captureOrder(
                            $paypalOrderId,
                            'capture-order-' . $order->id
                        )
                        : $providerOrder;

                    if (($captureResult['status'] ?? null) !== 'COMPLETED') {
                        throw new BillingExceptionClass('PayPal capture pending', 'PayPal has not completed this payment yet.', BillingException::TYPE_PAYMENT, $order->id, 'paypal', $paypalOrderId, ['capture_summary' => LogSanitizer::summarizeProviderPayload($captureResult)]);
                    }

                    $this->integrityService->assertPayPalOrder($order, $tx, $captureResult);
                    $this->captureService->record($order, $tx, $captureResult);
                },
                $providerStatus === 'COMPLETED',
            );

            $order->refresh();
            Log::info('Final order status after fulfillment', [
                'order_id' => $order->id,
                'status' => $order->status,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Order processed successfully',
                'order_id' => $order->id,
            ]);
        } catch (BillingExceptionClass|DisplayException|\Illuminate\Database\Eloquent\ModelNotFoundException|\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e) {
            // Re-throw billing exceptions to display to user
            throw $e;
        } catch (\Exception $e) {
            Log::error('PayPal capture exception', array_merge([
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
            ], LogSanitizer::exceptionContext($e)));

            $tx = PaymentTransaction::where('processor', 'paypal')
                ->where('external_id', $paypalOrderId)
                ->first();
            $order = $tx?->order;

            throw new BillingExceptionClass('PayPal capture error', 'An unexpected error occurred while capturing PayPal payment: ' . $e->getMessage(), BillingException::TYPE_PAYMENT, $order?->id, 'paypal', $paypalOrderId, ['error' => $e->getMessage()], $e);
        }
    }

    /**
     * Check the status of a PayPal order.
     */
    public function checkOrderStatus(Request $request): JsonResponse
    {
        $paypalOrderId = $request->input('order_id');

        Log::info('PayPal order status check requested', [
            'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
            'user_id' => $request->user()->id,
        ]);

        if (!$paypalOrderId) {
            // Fallback: Get the latest PayPal order for this user
            $order = Order::where('user_id', $request->user()->id)
                ->where('payment_processor', 'paypal')
                ->latest()
                ->first();
        } else {
            // Get the order by paypal_order_id
            $transaction = PaymentTransaction::where('processor', 'paypal')
                ->where('external_id', $paypalOrderId)
                ->first();
            $order = $transaction?->order;
            if ($order?->user_id !== $request->user()->id) {
                $order = null;
            }
        }

        if (!$order) {
            Log::warning('PayPal status check: Order not found', [
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'user_id' => $request->user()->id,
            ]);

            return response()->json([
                'processed' => false,
                'failed' => false,
                'pending' => true,
                'order_id' => $paypalOrderId,
                'order_status' => 'unknown',
            ]);
        }

        // Get current order status from PayPal
        $orderStatus = 'unknown';
        try {
            if ($order->paypal_order_id) {
                $orderStatus = $this->paypalService->getOrderStatus($order->paypal_order_id);
            }
        } catch (\Exception $e) {
            Log::warning('Failed to fetch PayPal order status', array_merge([
                'paypal_order_id' => LogSanitizer::maskIdentifier($order->paypal_order_id),
            ], LogSanitizer::exceptionContext($e)));
        }

        // Map order status
        $processed = $order->status === Order::STATUS_PROCESSED;
        $requiresReconciliation = $order->status === Order::STATUS_PAYMENT_REVIEW;
        $failed = in_array($order->status, [
            Order::STATUS_FAILED,
            Order::STATUS_CANCELLED,
        ], true);
        $pending = !$processed && !$failed && !$requiresReconciliation;

        Log::info('PayPal order status check result', [
            'order_id' => $order->id,
            'paypal_order_id' => LogSanitizer::maskIdentifier($order->paypal_order_id),
            'internal_status' => $order->status,
            'paypal_status' => $orderStatus,
            'processed' => $processed,
            'failed' => $failed,
            'pending' => $pending,
            'requires_reconciliation' => $requiresReconciliation,
        ]);

        return response()->json([
            'processed' => $processed,
            'failed' => $failed,
            'pending' => $pending,
            'requires_reconciliation' => $requiresReconciliation,
            'order_id' => $order->paypal_order_id,
            'order_status' => $orderStatus,
            'internal_order_id' => $order->id,
        ]);
    }

    /**
     * Cancel a pending PayPal order when the user cancels on the PayPal site.
     *
     * PayPal redirects back to the cancel URL with a `token` query param equal
     * to the PayPal Order ID. We look up the matching pending order and mark it
     * as failed so it no longer appears as "pending" in the dashboard.
     */
    public function cancelOrder(Request $request): JsonResponse
    {
        $paypalOrderId = $request->input('order_id');

        if (!$paypalOrderId) {
            return response()->json(['success' => false, 'message' => 'No order ID provided.'], 422);
        }

        // Primary lookup via PaymentTransaction (consistent with the rest of the codebase)
        $tx = PaymentTransaction::where('processor', 'paypal')
            ->where('external_id', $paypalOrderId)
            ->first();
        $order = $tx?->order;

        // Fallback: older orders may store the PayPal Order ID directly on the Order row
        if (!$order) {
            $order = Order::where('paypal_order_id', $paypalOrderId)->first();
        }

        if (!$order || $order->user_id !== $request->user()->id) {
            // Return success to avoid leaking order existence
            return response()->json(['success' => true]);
        }

        // Only update if the order is still pending; never downgrade a processed order
        if ($this->reservationService->transitionAndRelease(
            $order,
            Order::STATUS_PENDING,
            Order::STATUS_CANCELLED,
            null,
            'cancelled',
        )) {
            Log::info('PayPal order marked cancelled due to customer cancellation', [
                'order_id' => $order->id,
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'user_id' => $request->user()->id,
            ]);
        }

        return response()->json(['success' => true]);
    }

    /**
     * Get order details from token.
     */
    public function getOrderFromToken(Request $request, string $token): JsonResponse
    {
        $transaction = PaymentTransaction::where('processor', 'paypal')
            ->where('payment_token', $token)
            ->firstOrFail();
        $order = $transaction->order;
        abort_if($order->user_id !== $request->user()->id, 403);

        return response()->json([
            'order_id' => $transaction->external_id,
            'status' => $order->status,
            'product_id' => $order->product_id,
        ]);
    }

    private function resumePayPalCheckout(
        Request $request,
        Order $order,
    ): JsonResponse {
        /** @var PaymentTransaction|null $transaction */
        $transaction = $order->transaction()->first();
        if ($transaction === null) {
            throw new DisplayException('The existing checkout has no payment ledger.');
        }
        if (!$transaction->external_id) {
            return $this->createAndAttachPayPalOrder($request, $order);
        }

        $providerOrder = $this->paypalService->getOrder($transaction->external_id);
        $this->integrityService->assertPayPalOrder($order, $transaction, $providerOrder);
        $approvalUrl = $this->paypalService->getApprovalUrl($providerOrder);
        if (!$approvalUrl) {
            throw new DisplayException('The existing PayPal checkout is no longer awaiting approval.');
        }
        $this->assertCheckoutStillPending($order);

        return response()->json([
            'id' => $transaction->external_id,
            'token' => $transaction->payment_token,
            'approval_url' => $this->validateRedirectUrl($approvalUrl, ['paypal.com']),
        ]);
    }

    private function createAndAttachPayPalOrder(
        Request $request,
        Order $order,
    ): JsonResponse {
        /** @var PaymentTransaction $transaction */
        $transaction = $order->transaction()->firstOrFail();
        $token = (string) ($transaction->payment_token ?: $order->payment_token);
        if ($token === '') {
            throw new DisplayException('The existing checkout has no return token.');
        }

        $baseReturnUrl = $request->input('return_url', url('/account/billing/processing'));
        $returnUrl = str_contains($baseReturnUrl, '?')
            ? $baseReturnUrl . '&token=' . $token . '&processor=paypal'
            : $baseReturnUrl . '?token=' . $token . '&processor=paypal';
        $cancelUrl = $request->input('cancel_url', url('/account/billing/cancel'));

        $paypalOrder = $this->paypalService->createOrder(
            $this->paypalOrderCreationService->payload($order, $returnUrl, $cancelUrl),
            'checkout-order-' . $order->id,
        );

        DB::transaction(function () use ($order, $paypalOrder): void {
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction $lockedTransaction */
            $lockedTransaction = PaymentTransaction::query()
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
                || ($lockedOrder->paypal_order_id && $lockedOrder->paypal_order_id !== $paypalOrder['id'])
                || ($lockedTransaction->external_id && $lockedTransaction->external_id !== $paypalOrder['id'])
            ) {
                throw new DisplayException('This checkout can no longer accept a PayPal order.');
            }

            $lockedOrder->forceFill(['paypal_order_id' => $paypalOrder['id']])->saveOrFail();
            if (!$lockedTransaction->external_id) {
                $lockedTransaction->forceFill(['external_id' => $paypalOrder['id']])->saveOrFail();
            }
        });

        /** @var PaymentTransaction $transaction */
        $transaction = $order->transaction()->firstOrFail();
        $this->integrityService->assertPayPalOrder($order, $transaction, $paypalOrder);
        $approvalUrl = $this->paypalService->getApprovalUrl($paypalOrder);
        if (!$approvalUrl) {
            throw new DisplayException('PayPal approval URL unavailable.');
        }
        $this->assertCheckoutStillPending($order);

        return response()->json([
            'id' => $paypalOrder['id'],
            'token' => $token,
            'approval_url' => $this->validateRedirectUrl($approvalUrl, ['paypal.com']),
        ]);
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

    private function assertBillingAddressPresent(\Everest\Models\User $user): void
    {
        $settings = $this->invoiceSettingsService->get();
        if (!$settings->require_billing_address) {
            return;
        }

        $profile = $user->billingProfile;
        $data = is_array($profile?->encrypted_data) ? $profile->encrypted_data : [];
        $required = ['first_name', 'last_name', 'address_line1', 'city', 'state', 'postal_code', 'country'];
        $complete = $profile !== null && collect($required)->every(
            fn (string $field): bool => is_string($data[$field] ?? null)
                && trim($data[$field]) !== ''
        );

        if (!$complete) {
            abort(response()->json([
                'error' => 'A valid billing address is required to complete checkout.',
                'error_code' => 'billing_address_required',
            ], 422));
        }
    }
}
