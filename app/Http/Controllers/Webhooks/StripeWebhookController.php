<?php

namespace Everest\Http\Controllers\Webhooks;

use Everest\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Stripe\Webhook as StripeWebhook;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Services\Billing\StripeCaptureService;
use Everest\Services\Billing\PaymentWebhookRegistry;
use Everest\Services\Billing\ServerFulfillmentService;

/**
 * Handles incoming Stripe webhook events.
 *
 * Signature verification is performed via Stripe's SDK using the
 * STRIPE_WEBHOOK_SECRET environment variable.
 */
class StripeWebhookController
{
    public function __construct(
        private StripeCaptureService $captureService,
        private ServerFulfillmentService $fulfillmentService,
    ) {
    }

    /**
     * Handle a Stripe webhook notification.
     */
    public function handle(Request $request): JsonResponse
    {
        $webhookSecret = config('services.stripe.webhook_secret');

        if (empty($webhookSecret)) {
            Log::error('Stripe webhook secret is not configured — ignoring webhook');

            return response()->json(['ok' => false, 'error' => 'Webhook secret not configured'], 500);
        }

        // Verify signature using Stripe's SDK
        $signature = $request->header('Stripe-Signature');
        if (!$signature) {
            Log::warning('Stripe webhook received without Stripe-Signature header');

            return response()->json(['ok' => false], 400);
        }

        try {
            $event = StripeWebhook::constructEvent(
                $request->getContent(),
                $signature,
                $webhookSecret,
                config('services.stripe.webhook_tolerance', 300)
            );
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            Log::warning('Stripe webhook signature verification failed', [
                'error' => $e->getMessage(),
            ]);

            return response()->json(['ok' => false], 403);
        } catch (\UnexpectedValueException $e) {
            Log::warning('Stripe webhook payload parse failed', [
                'error' => $e->getMessage(),
            ]);

            return response()->json(['ok' => false], 400);
        }

        try {
            $this->dispatch($event);
        } catch (\Exception $e) {
            Log::error('Error processing Stripe webhook event', [
                'event_type' => $event->type,
                'event_id'   => $event->id,
                'error'      => $e->getMessage(),
            ]);

            // A verified event is provider evidence. Return a retryable status
            // until its durable local processing succeeds.
            return response()->json(['ok' => false, 'error' => 'Internal error processing event'], 500);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Dispatch the verified Stripe event to the appropriate handler.
     */
    private function dispatch(\Stripe\Event $event): void
    {
        match ($event->type) {
            PaymentWebhookRegistry::STRIPE_CUSTOMER_DELETED => $this->handleCustomerDeleted($event),
            PaymentWebhookRegistry::STRIPE_PAYMENT_INTENT_SUCCEEDED => $this->handlePaymentIntentSucceeded($event),
            default => null, // Unhandled events are silently ignored
        };
    }

    /**
     * Recover a capture that succeeded at Stripe when the browser or Panel
     * process failed before recording it or completing fulfillment.
     */
    private function handlePaymentIntentSucceeded(\Stripe\Event $event): void
    {
        $intent = $event->data->object;
        $intentId = $intent->id ?? null;
        if (!is_string($intentId) || $intentId === '') {
            throw new \UnexpectedValueException('payment_intent.succeeded event is missing its intent ID.');
        }

        /** @var PaymentTransaction|null $transaction */
        $transaction = PaymentTransaction::query()
            ->where('processor', 'stripe')
            ->where('external_id', $intentId)
            ->first();
        if ($transaction === null || $transaction->order === null) {
            Log::info('Stripe capture event has no matching local checkout', [
                'event_id' => $event->id,
            ]);

            return;
        }

        $order = $transaction->order;
        $this->captureService->record($order, $transaction, $intent);
        $this->fulfillmentService->fulfillOrder(new Request(), $order);
    }

    /**
     * Handle customer.deleted without clearing the matching identifier.
     *
     * StripeCustomerService deliberately derives a replacement idempotency key
     * from the deleted Customer ID and swaps it under a row lock. Retaining the
     * stale ID until that swap both prevents a delayed webhook from clearing a
     * newer Customer and avoids reusing the original Customer creation key.
     */
    private function handleCustomerDeleted(\Stripe\Event $event): void
    {
        /** @var \Stripe\Customer $customer */
        $customer = $event->data->object;
        $customerId = $customer->id ?? null;

        if (!$customerId) {
            Log::warning('customer.deleted event missing customer id');

            return;
        }

        $user = User::where('stripe_id', $customerId)->first();

        if (!$user) {
            // Customer was never matched to a local user — nothing to do
            Log::info('customer.deleted event for unknown Customer, no local user matched', [
                'customer_id' => $customerId,
            ]);

            return;
        }

        Log::info('Stripe Customer deletion recorded; stale identifier retained for replacement', [
            'user_id' => $user->id,
            'customer_id' => $customerId,
        ]);
    }
}
