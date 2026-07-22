<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Log;
use Illuminate\Http\RedirectResponse;
use Everest\Exceptions\DisplayException;
use Everest\Traits\ValidatesRedirectUrl;
use Everest\Services\Security\LogSanitizer;
use Everest\Models\Billing\BillingException;
use Everest\Services\Billing\BillingDefaults;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\CreateOrderService;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\ServerFulfillmentService;
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
    ) {
        parent::__construct();
    }

    /**
     * Create a PayPal order.
     *
     * @param int $id Product ID
     */
    public function createOrder(Request $request, int $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        // Check if this is a renewal payment
        $isRenewal = $request->boolean('renewal', false);
        $serverId = $request->input('server_id') ? (int) $request->input('server_id') : null;
        $billingDays = (int) ($request->input('billing_days') ?? BillingDefaults::defaultBillingDays());

        // Determine order type and calculate price
        $orderType = $isRenewal ? Order::TYPE_REN : Order::TYPE_NEW;
        $couponId = $request->input('coupon_id') ? (int) $request->input('coupon_id') : null;
        $priceInfo = $this->validationService->calculatePriceWithCoupon(
            $product,
            $couponId,
            $isRenewal ? 'ren' : 'new',
            $billingDays,
            null, // node ID
            $request->user()->id
        );

        // If the coupon makes the order free, skip PayPal order creation entirely.
        // The frontend should route to processFree when total is $0.
        if ($couponId !== null && $priceInfo['finalPrice'] <= 0.0001) {
            return response()->json(['free' => true]);
        }

        // Validate this is not a free order
        $this->validationService->validatePriceType($priceInfo['finalPrice'], false);

        // Generate a secure random token for order tracking
        $token = \Illuminate\Support\Str::uuid()->toString();

        // Setup return and cancel URLs
        $baseReturnUrl = $request->input('return_url', url('/account/billing/processing'));
        $returnUrl = str_contains($baseReturnUrl, '?')
            ? $baseReturnUrl . '&token=' . $token . '&processor=paypal'
            : $baseReturnUrl . '?token=' . $token . '&processor=paypal';

        $cancelUrl = $request->input('cancel_url', url('/account/billing/cancel'));

        // Create PayPal order
        $paypalOrder = $this->paypalService->createOrder(
            $product,
            $priceInfo['finalPrice'],
            $couponId,
            $returnUrl,
            $cancelUrl
        );

        // Store order in database
        $orderData = [
            'payment_processor' => 'paypal',
            'paypal_order_id' => $paypalOrder['id'],
            'payment_token' => $token,
            'name' => $isRenewal ? 'Server Renewal' : 'Pending',
            'node_id' => null,
            'server_id' => $isRenewal ? $serverId : null,
            'billing_days' => $billingDays,
            'variables' => [],
            'domain_payload' => [],
        ];

        $this->orderService->create(
            null, // PayPal doesn't use payment_intent_id
            $request->user(),
            $product,
            Order::STATUS_PENDING,
            $orderType,
            $couponId,
            null, // egg_id will be set in updateOrder for new orders
            $orderData,
            $priceInfo['finalPrice'],
            $priceInfo['subtotal'],
            $priceInfo['discount']
        );

        // Get approval URL for redirect
        $approvalUrl = $this->paypalService->getApprovalUrl($paypalOrder);
        if (!$approvalUrl) {
            throw new DisplayException('PayPal approval URL unavailable.');
        }
        $approvalUrl = $this->validateRedirectUrl($approvalUrl, ['paypal.com']);

        return response()->json([
            'id' => $paypalOrder['id'],
            'token' => $token,
            'approval_url' => $approvalUrl,
        ]);
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

        $paypalOrder = $this->paypalService->getOrder($orderId);
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
        $paypalOrderId = $request->input('order_id');

        // Validate billing is enabled
        $this->validationService->validateBillingEnabled();

        // Check if this is a renewal
        $isRenewal = $request->has('renewal') && $request->boolean('renewal');

        // For renewals, name and node_id are optional (server already exists)
        // For new purchases, they are required
        $serverName = trim((string) $request->input('name', ''));
        if (!$isRenewal && empty($serverName)) {
            throw new DisplayException('Server name is required.');
        }

        $nodeId = (int) $request->input('node_id');
        // Only validate node deployment for new purchases, not renewals
        if (!$isRenewal) {
            $this->validationService->validateNodeSelectionForProduct($nodeId, $product);
            $this->validationService->validateNodeDeployment($nodeId, false);
        }

        // For renewals, egg_id is not required
        $requestedEggId = $request->input('egg_id') ? (int) $request->input('egg_id') : null;
        $eggId = $isRenewal ? null : $this->validationService->validateAndGetEggId($product, $requestedEggId);
        $billingDays = (int) ($request->input('billing_days') ?? BillingDefaults::defaultBillingDays());

        // Determine order type
        $orderType = Order::resolveTypeFromRequest($request);
        $couponId = $request->input('coupon_id') ? (int) $request->input('coupon_id') : null;
        $variables = $request->input('variables', []);
        $domainPayload = $request->input('domain_payload', []);
        $serverId = $request->input('server_id') ? (int) $request->input('server_id') : null;

        // Find the existing pending order and update it
        $transaction = PaymentTransaction::where('processor', 'paypal')
            ->where('external_id', $paypalOrderId)
            ->firstOrFail();
        $order = $transaction->order;
        abort_if($order->user_id !== $request->user()->id, 403);
        abort_if($order->status !== Order::STATUS_PENDING, 404);

        $order->update([
            'name' => $isRenewal ? 'Server Renewal' : $serverName,
            'node_id' => $isRenewal ? null : $nodeId,
            'server_id' => $serverId,
            'egg_id' => $isRenewal ? null : $eggId,
            'type' => $orderType,
            'coupon_id' => $couponId,
            'billing_days' => $billingDays,
            'variables' => $variables,
            'domain_payload' => is_array($domainPayload) ? $domainPayload : [],
        ]);

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
    public function captureOrder(Request $request): JsonResponse
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
            // Find our order record
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

            // Check idempotency - already processed?
            if ($order->status === Order::STATUS_PROCESSED) {
                Log::info('Order already processed, returning success', ['order_id' => $order->id]);

                return response()->json([
                    'success' => true,
                    'message' => 'Order already processed',
                    'order_id' => $order->id,
                ]);
            }

            // Verify the PayPal order is approved
            $isApproved = $this->paypalService->isOrderApproved($paypalOrderId);
            Log::info('PayPal order approval status', [
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'is_approved' => $isApproved,
            ]);

            if (!$isApproved) {
                Log::warning('PayPal order not approved yet', ['paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId)]);
                throw new BillingExceptionClass('PayPal order not approved', 'PayPal order is not approved yet. Please complete the payment on PayPal.', BillingException::TYPE_PAYMENT, $order->id, 'paypal', $paypalOrderId, ['order_status' => 'not_approved']);
            }

            // Capture the payment
            Log::info('Attempting to capture PayPal payment', ['paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId)]);
            $captureResult = $this->paypalService->captureOrder($paypalOrderId);

            // Verify capture was successful
            $captureStatus = $captureResult['status'] ?? '';
            Log::info('PayPal capture result', [
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'capture_status' => $captureStatus,
            ]);

            if ($captureStatus !== 'COMPLETED') {
                Log::error('PayPal capture failed', [
                    'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                    'expected_status' => 'COMPLETED',
                    'actual_status' => $captureStatus,
                ]);
                // Dispatch PaymentFailed email
                $this->fulfillmentService->dispatchPaymentFailedEmail($order, 'PayPal capture failed. Status: ' . $captureStatus, 'paypal');
                throw new BillingExceptionClass('PayPal capture failed', 'Failed to capture PayPal payment. Status: ' . $captureStatus . '. Please try again or contact support.', BillingException::TYPE_PAYMENT, $order->id, 'paypal', $paypalOrderId, ['capture_status' => $captureStatus, 'capture_summary' => LogSanitizer::summarizeProviderPayload($captureResult)]);
            }

            // Extract and save PayPal transaction details
            $purchaseUnit = $captureResult['purchase_units'][0] ?? null;
            $capture = $purchaseUnit['payments']['captures'][0] ?? null;
            $payer = $captureResult['payer'] ?? null;

            if ($capture) {
                $order->paypal_capture_id = $capture['id'] ?? null;
                $order->paypal_status = $capture['status'] ?? null;
                $order->paypal_amount = isset($capture['amount']['value']) ? (float) $capture['amount']['value'] : null;
                $order->paypal_currency = $capture['amount']['currency_code'] ?? null;
                $order->paypal_captured_at = isset($capture['create_time']) ? \Carbon\Carbon::parse($capture['create_time']) : null;
            }

            if ($payer) {
                $order->paypal_payer_id = $payer['payer_id'] ?? null;
                $order->paypal_payer_email = $payer['email_address'] ?? null;
            }

            $order->save();

            // Sync captured PayPal details to the payment_transactions record
            try {
                $transaction = $order->transaction;
                if ($transaction) {
                    $transaction->update([
                        'status'      => $order->paypal_status,
                        'capture_id'  => $order->paypal_capture_id,
                        'amount'      => $order->paypal_amount,
                        'currency'    => $order->paypal_currency,
                        'payer_id'    => $order->paypal_payer_id,
                        'payer_email' => $order->paypal_payer_email,
                        'captured_at' => $order->paypal_captured_at,
                    ]);
                }
            } catch (\Exception $e) {
                Log::warning('Failed to sync PayPal capture to PaymentTransaction', [
                    'order_id' => $order->id,
                    'error'    => $e->getMessage(),
                ]);
            }

            Log::info('Saved PayPal transaction details', [
                'order_id' => $order->id,
                'capture_id' => LogSanitizer::maskIdentifier($order->paypal_capture_id),
                'amount' => $order->paypal_amount,
                'currency' => $order->paypal_currency,
            ]);

            // Fulfill the order
            Log::info('Starting order fulfillment', ['order_id' => $order->id]);
            try {
                $this->fulfillOrder($request, $order);
                Log::info('Order fulfillment completed successfully', ['order_id' => $order->id]);
            } catch (\Exception $e) {
                Log::error('Order fulfillment failed', array_merge([
                    'order_id' => $order->id,
                ], LogSanitizer::exceptionContext($e)));
                throw $e;
            }

            // Reload order to get updated status
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
        } catch (BillingExceptionClass $e) {
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
        $failed = in_array($order->status, [Order::STATUS_FAILED, Order::STATUS_CANCELLED], true);
        $pending = !$processed && !$failed;

        Log::info('PayPal order status check result', [
            'order_id' => $order->id,
            'paypal_order_id' => LogSanitizer::maskIdentifier($order->paypal_order_id),
            'internal_status' => $order->status,
            'paypal_status' => $orderStatus,
            'processed' => $processed,
            'failed' => $failed,
            'pending' => $pending,
        ]);

        return response()->json([
            'processed' => $processed,
            'failed' => $failed,
            'pending' => $pending,
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
        if ($order->status === Order::STATUS_PENDING) {
            $order->update(['status' => Order::STATUS_CANCELLED]);

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

    /**
     * Fulfill an order after successful payment.
     */
    private function fulfillOrder(Request $request, Order $order): void
    {
        // Use centralized fulfillment service
        $this->fulfillmentService->fulfillOrder($request, $order);
    }

    /**
     * Process PayPal webhook notifications.
     *
     * This endpoint receives asynchronous notifications from PayPal about payment events.
     * It verifies the webhook, fetches the actual payment status from PayPal API,
     * and fulfills orders for successful payments.
     *
     * Important: This route is outside authentication middleware as PayPal calls it directly.
     */
    public function processPayment(Request $request): Response
    {
        $eventType = $request->input('event_type');
        $resource = $request->input('resource', []);

        // Extract PayPal order ID based on event type
        // Different event types have order ID in different locations
        $paypalOrderId = null;

        switch ($eventType) {
            case 'PAYMENT.CAPTURE.COMPLETED':
            case 'PAYMENT.CAPTURE.DENIED':
            case 'PAYMENT.CAPTURE.REFUNDED':
            case 'PAYMENT.CAPTURE.REVERSED':
                // For all capture-related events, order ID is in supplementary_data
                // These events all relate to the same order and need the same extraction logic
                // Use safe array access to handle potentially missing nested keys
                if (isset($resource['supplementary_data']['related_ids']['order_id'])) {
                    $paypalOrderId = $resource['supplementary_data']['related_ids']['order_id'];
                }
                break;

            case 'CHECKOUT.ORDER.APPROVED':
            case 'CHECKOUT.ORDER.COMPLETED':
            case 'CHECKOUT.ORDER.SAVED':
                // For order events, ID is directly in the resource
                $paypalOrderId = $resource['id'] ?? null;
                break;

            default:
                // Unsupported event type - this may be a new PayPal event we haven't implemented yet
                // or an event not relevant to our billing flow. Return 200 to acknowledge receipt.
                Log::warning('Unsupported PayPal webhook event type received', [
                    'event_type' => $eventType,
                    'resource_id' => $resource['id'] ?? null,
                    'resource_type' => $request->input('resource_type'),
                    'note' => 'This may be expected for certain PayPal events. Review PayPal webhook settings if unexpected.',
                ]);

                return $this->returnNoContent();
        }

        if (!$paypalOrderId) {
            // Return 200 to prevent PayPal retries, but log the issue
            Log::warning('PayPal webhook: Could not extract order ID from event', [
                'event_type' => $eventType,
                'resource_id' => $resource['id'] ?? null,
                'resource_type' => $request->input('resource_type'),
            ]);

            return $this->returnNoContent();
        }

        // Find the order by paypal_order_id
        $transaction = PaymentTransaction::where('processor', 'paypal')
            ->where('external_id', $paypalOrderId)
            ->latest()
            ->first();
        $order = $transaction?->order;

        if (!$order) {
            // Return 200 to prevent PayPal retries for non-existent orders
            Log::warning('PayPal webhook order not found', [
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
            ]);

            return $this->returnNoContent();
        }

        // IDEMPOTENCY: Check if payment is already in a final state (processed, failed, or cancelled)
        // This prevents duplicate processing if webhook is called multiple times
        if (in_array($order->status, [Order::STATUS_PROCESSED, Order::STATUS_FAILED, Order::STATUS_CANCELLED], true)) {
            Log::info("PayPal webhook: Order {$order->id} already in final state: {$order->status}");

            return $this->returnNoContent();
        }

        try {
            // Validate billing is enabled
            $this->validationService->validateBillingEnabled();

            // SECURITY: Fetch order details from PayPal API (never trust webhook data directly)
            // This also verifies the webhook is legitimate
            $paypalOrder = $this->paypalService->getOrder($paypalOrderId);

            // Handle different order statuses according to PayPal documentation
            // https://developer.paypal.com/docs/api/orders/v2/#orders_get
            $status = $paypalOrder['status'] ?? 'UNKNOWN';

            Log::info('Processing PayPal webhook', [
                'event_type' => $eventType,
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'order_id' => $order->id,
                'paypal_status' => $status,
                'order_status' => $order->status,
            ]);

            switch ($status) {
                case 'COMPLETED':
                    // Payment captured successfully - fulfill the order
                    Log::info('PayPal webhook completed order', [
                        'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                        'order_id' => $order->id,
                    ]);
                    $this->fulfillOrder($request, $order);
                    break;

                case 'APPROVED':
                    // Order approved but not yet captured
                    // This shouldn't happen if we auto-capture, but keep order as pending
                    Log::info('PayPal webhook approved order pending capture', [
                        'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                        'order_id' => $order->id,
                    ]);
                    break;

                case 'VOIDED':
                case 'EXPIRED':
                    // Order voided or expired - mark as failed
                    Log::info('PayPal webhook marked order failed', [
                        'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                        'order_id' => $order->id,
                        'paypal_status' => $status,
                    ]);
                    $order->update(['status' => Order::STATUS_FAILED]);
                    break;

                case 'CREATED':
                case 'SAVED':
                case 'PAYER_ACTION_REQUIRED':
                    // Order in progress - keep as pending
                    Log::info('PayPal webhook order still pending action', [
                        'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                        'order_id' => $order->id,
                        'paypal_status' => $status,
                    ]);
                    break;

                default:
                    // Unknown status - log for investigation
                    Log::warning('PayPal webhook returned unknown status', [
                        'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                        'paypal_status' => $status,
                    ]);
            }
        } catch (BillingExceptionClass $e) {
            // Log the billing exception but return 200 to prevent PayPal retries
            // The exception is already logged to the database by BillingException
            Log::error('PayPal webhook billing exception', [
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                'exception_type' => $e->getExceptionType(),
                'message' => $e->getMessage(),
                'order_id' => $e->getOrderId(),
            ]);
        } catch (\Exception $e) {
            // Log error but return 200 to prevent infinite PayPal retries
            // Create a billing exception for admin review
            Log::error('PayPal webhook error', array_merge([
                'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
            ], LogSanitizer::exceptionContext($e)));

            try {
                throw new BillingExceptionClass('PayPal webhook processing error', 'Failed to process PayPal webhook: ' . $e->getMessage(), BillingException::TYPE_WEBHOOK, $order->id, 'paypal', $paypalOrderId, ['event_type' => $eventType, 'error' => $e->getMessage()], $e);
            } catch (BillingExceptionClass $billingEx) {
                // Exception is now logged, continue to return 200
            }
        }

        return $this->returnNoContent();
    }
}
