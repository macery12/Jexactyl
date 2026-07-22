<?php

namespace Everest\Http\Controllers\Webhooks;

use Everest\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Stripe\Webhook as StripeWebhook;
use Everest\Services\Billing\StripeCustomerService;

/**
 * Handles incoming Stripe webhook events.
 *
 * Currently processes:
 *  - customer.deleted  → clears the stored stripe_id on the corresponding User
 *
 * Signature verification is performed via Stripe's SDK using the
 * STRIPE_WEBHOOK_SECRET environment variable.
 */
class StripeWebhookController
{
    public function __construct(
        private StripeCustomerService $stripeCustomerService,
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

            // Return 200 to prevent Stripe from retrying — the error is logged
            return response()->json(['ok' => false, 'error' => 'Internal error processing event'], 200);
        }

        return response()->json(['ok' => true]);
    }

    /**
     * Dispatch the verified Stripe event to the appropriate handler.
     */
    private function dispatch(\Stripe\Event $event): void
    {
        match ($event->type) {
            'customer.deleted' => $this->handleCustomerDeleted($event),
            default => null, // Unhandled events are silently ignored
        };
    }

    /**
     * Handle customer.deleted: clear stripe_id from the matching User record.
     *
     * This prevents stale Customer IDs from causing errors on the next checkout.
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

        $this->stripeCustomerService->clearForUser($user);
    }
}
