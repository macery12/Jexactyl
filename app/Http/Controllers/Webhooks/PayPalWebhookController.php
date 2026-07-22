<?php

namespace Everest\Http\Controllers\Webhooks;

use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Everest\Services\Security\LogSanitizer;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\PayPalWebhookVerificationService;

class PayPalWebhookController
{
    public function __construct(
        private PayPalPaymentService $paypalService,
        private PayPalWebhookVerificationService $verificationService,
        private BillingValidationService $validationService,
        private ServerFulfillmentService $fulfillmentService,
    ) {
    }

    /**
     * Handle PayPal webhook notifications.
     *
     * This endpoint receives asynchronous notifications from PayPal about payment events.
     * It verifies the webhook, fetches the actual payment status from PayPal API,
     * and fulfills orders for successful payments.
     *
     * Important: This endpoint is public and receives requests directly from PayPal.
     * No authentication or user context is available.
     */
    public function handle(Request $request): JsonResponse
    {
        try {
            $verification = $this->verificationService->validate($request);

            if (!$verification['valid']) {
                Log::warning('Rejected PayPal webhook request', array_merge([
                    'reason' => $verification['reason'],
                ], $verification['context'] ?? []));

                return response()->json(['ok' => false], $verification['status']);
            }

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
                    Log::warning('Unsupported PayPal webhook event type received', [
                        'event_type' => $eventType,
                        'resource_id' => $resource['id'] ?? null,
                        'resource_type' => $request->input('resource_type'),
                        'note' => 'This may be expected for certain PayPal events. Review PayPal webhook settings if unexpected.',
                    ]);

                    return response()->json(['ok' => true], 200);
            }

            if (!$paypalOrderId) {
                Log::warning('PayPal webhook: Could not extract order ID from event', [
                    'event_type' => $eventType,
                    'resource_id' => $resource['id'] ?? null,
                    'resource_type' => $request->input('resource_type'),
                ]);

                return response()->json(['ok' => true], 200);
            }

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

                return response()->json(['ok' => true], 200);
            }

            // IDEMPOTENCY: Check if payment is already in a final state (processed, failed, or cancelled)
            // This prevents duplicate processing if webhook is called multiple times
            if (in_array($order->status, [Order::STATUS_PROCESSED, Order::STATUS_FAILED, Order::STATUS_CANCELLED], true)) {
                Log::info("PayPal webhook: Order {$order->id} already in final state: {$order->status}");

                return response()->json(['ok' => true], 200);
            }

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
                    // Payment captured successfully - record payer/capture identifiers then fulfill
                    Log::info('PayPal webhook completed order', [
                        'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                        'order_id' => $order->id,
                    ]);

                    // Persist payer and capture details so they are available regardless of
                    // whether the order was fulfilled via the client-side captureOrder endpoint
                    // or this webhook path.
                    $purchaseUnit = $paypalOrder['purchase_units'][0] ?? null;
                    $capture = $purchaseUnit['payments']['captures'][0] ?? null;
                    $payer = $paypalOrder['payer'] ?? null;

                    if ($capture) {
                        $order->paypal_capture_id = $order->paypal_capture_id ?? ($capture['id'] ?? null);
                        $order->paypal_status = $capture['status'] ?? null;
                        $order->paypal_amount = $order->paypal_amount ?? (isset($capture['amount']['value']) ? (float) $capture['amount']['value'] : null);
                        $order->paypal_currency = $order->paypal_currency ?? ($capture['amount']['currency_code'] ?? null);
                        $order->paypal_captured_at = $order->paypal_captured_at ?? (isset($capture['create_time']) ? \Carbon\Carbon::parse($capture['create_time']) : null);
                    }

                    if ($payer) {
                        $order->paypal_payer_id = $order->paypal_payer_id ?? ($payer['payer_id'] ?? null);
                        $order->paypal_payer_email = $order->paypal_payer_email ?? ($payer['email_address'] ?? null);
                    }

                    $order->save();

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
        } catch (\Throwable $e) {
            // Log error but return 200 to prevent infinite PayPal retries
            Log::error('PayPal webhook error', LogSanitizer::exceptionContext($e));
        }

        return response()->json(['ok' => true], 200);
    }

    /**
     * Fulfill an order after successful payment.
     */
    private function fulfillOrder(Request $request, Order $order): void
    {
        // Use centralized fulfillment service
        $this->fulfillmentService->fulfillOrder($request, $order, null);
    }
}
