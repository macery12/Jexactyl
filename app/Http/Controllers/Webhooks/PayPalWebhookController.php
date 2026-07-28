<?php

namespace Everest\Http\Controllers\Webhooks;

use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Everest\Services\Security\LogSanitizer;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\PayPalCaptureService;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\PaymentWebhookRegistry;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\PayPalWebhookEventService;
use Everest\Services\Billing\PayPalNegativeEventService;
use Everest\Services\Billing\PayPalWebhookVerificationService;

class PayPalWebhookController
{
    public function __construct(
        private PayPalPaymentService $paypalService,
        private PayPalWebhookVerificationService $verificationService,
        private ServerFulfillmentService $fulfillmentService,
        private CheckoutIntegrityService $integrityService,
        private PayPalCaptureService $captureService,
        private PayPalWebhookEventService $eventService,
        private PayPalNegativeEventService $negativeEventService,
    ) {
    }

    public function handle(Request $request): JsonResponse
    {
        $transmissionId = null;

        try {
            $verification = $this->verificationService->validate($request);
            if (!$verification['valid']) {
                Log::warning('Rejected PayPal webhook request', array_merge([
                    'reason' => $verification['reason'],
                ], $verification['context'] ?? []));

                return response()->json(['ok' => false], $verification['status']);
            }

            $transmissionId = (string) $verification['transmission_id'];
            $eventType = (string) $request->input('event_type');
            $resource = $request->input('resource', []);
            $paypalOrderId = $this->extractOrderId($eventType, is_array($resource) ? $resource : []);

            // Persist the provider-order correlation before any local lookup or
            // fulfillment work. Cleanup can then retain the matching local
            // order while a verified event is processing or awaiting retry.
            $eventResult = $this->eventService->begin(
                $transmissionId,
                $request->json()->all(),
                $paypalOrderId,
            );
            if ($eventResult === PayPalWebhookEventService::RESULT_COMPLETED) {
                return response()->json(['ok' => true]);
            }
            if ($eventResult === PayPalWebhookEventService::RESULT_RETRY) {
                return response()->json(['ok' => false], 503);
            }

            if ($paypalOrderId === null) {
                Log::warning('PayPal webhook did not contain an order identifier', [
                    'event_type' => $eventType,
                ]);
                $this->eventService->complete($transmissionId);

                return response()->json(['ok' => true]);
            }

            /** @var PaymentTransaction|null $transaction */
            $transaction = PaymentTransaction::query()
                ->where('processor', 'paypal')
                ->where('external_id', $paypalOrderId)
                ->first();
            $order = $transaction?->order;

            if ($order === null) {
                Log::warning('PayPal webhook order not found', [
                    'paypal_order_id' => LogSanitizer::maskIdentifier($paypalOrderId),
                ]);
                $this->eventService->complete($transmissionId);

                return response()->json(['ok' => true]);
            }

            if (in_array($eventType, PaymentWebhookRegistry::PAYPAL_NEGATIVE_EVENTS, true)) {
                $negative = $this->negativeEventService->record(
                    $order,
                    $transaction,
                    $eventType,
                    $transmissionId,
                );
                if ($negative['requires_reconciliation']) {
                    Log::critical('PayPal reported a negative event for an active or fulfilled order', [
                        'order_id' => $order->id,
                        'event_type' => $eventType,
                        'order_status' => $negative['order_status'],
                    ]);
                }
                $this->eventService->complete($transmissionId);

                return response()->json(['ok' => true]);
            }

            if (!in_array($eventType, PaymentWebhookRegistry::PAYPAL_POSITIVE_EVENTS, true)) {
                Log::info('PayPal webhook requires no fulfillment action', [
                    'event_type' => $eventType,
                    'order_id' => $order->id,
                ]);
                $this->eventService->complete($transmissionId);

                return response()->json(['ok' => true]);
            }

            // A verified duplicate completion is already satisfied even if the
            // customer later deleted the fulfilled server. This also cleanly
            // acknowledges legacy processed rows that predate snapshot fields.
            if ($order->status === Order::STATUS_PROCESSED) {
                $this->eventService->complete($transmissionId);

                return response()->json(['ok' => true]);
            }

            $providerOrder = $this->paypalService->getOrder($paypalOrderId);
            $this->integrityService->assertPayPalOrder($order, $transaction, $providerOrder);
            if (($providerOrder['status'] ?? null) !== 'COMPLETED') {
                throw new \RuntimeException('PayPal has not finalized the order referenced by a completion event.');
            }

            if (in_array($order->status, [
                Order::STATUS_FAILED,
                Order::STATUS_CANCELLED,
                Order::STATUS_EXPIRED,
                Order::STATUS_PAYMENT_REVIEW,
            ], true)) {
                // Record the captured financial truth, but do not silently
                // provision an order that local policy already terminated.
                $this->captureService->record($order, $transaction, $providerOrder);
                $transaction->forceFill(['status' => 'captured_review'])->saveOrFail();
                Log::critical('Captured PayPal payment requires manual reconciliation', [
                    'order_id' => $order->id,
                    'local_status' => $order->status,
                ]);
                $this->eventService->complete($transmissionId);

                return response()->json(['ok' => true]);
            }

            $this->fulfillmentService->fulfillPayPalOrder(
                $request,
                $order,
                function () use ($order, $transaction, $providerOrder): void {
                    $this->captureService->record($order, $transaction, $providerOrder);
                },
                true,
            );

            $this->eventService->complete($transmissionId);

            return response()->json(['ok' => true]);
        } catch (\Throwable $exception) {
            if ($transmissionId !== null) {
                try {
                    $this->eventService->fail($transmissionId, $exception);
                } catch (\Throwable $ledgerException) {
                    Log::critical('Failed to persist PayPal webhook failure state', [
                        'exception' => $ledgerException::class,
                    ]);
                }
            }

            Log::error('PayPal webhook processing failed', LogSanitizer::exceptionContext($exception));

            // Verified transient failures must be retried. The durable event
            // ledger and fulfillment claim make those retries idempotent.
            return response()->json(['ok' => false], 500);
        }
    }

    private function extractOrderId(string $eventType, array $resource): ?string
    {
        if (str_starts_with($eventType, 'PAYMENT.CAPTURE.')) {
            $value = $resource['supplementary_data']['related_ids']['order_id'] ?? null;

            return is_string($value) && $value !== '' ? $value : null;
        }

        if (str_starts_with($eventType, 'CHECKOUT.ORDER.')) {
            $value = $resource['id'] ?? null;

            return is_string($value) && $value !== '' ? $value : null;
        }

        return null;
    }
}
