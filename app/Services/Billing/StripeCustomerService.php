<?php

namespace Everest\Services\Billing;

use Everest\Models\User;
use Stripe\StripeClient;
use Everest\Models\Setting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Everest\Models\Billing\BillingException;
use Everest\Exceptions\Billing\BillingException as BillingExceptionClass;

/**
 * Resolves (or creates) a Stripe Customer for a given user.
 *
 * Using a Stripe Customer object ties every PaymentIntent to a real Stripe
 * identity so that:
 *  - The Stripe Dashboard shows all charges grouped by customer
 *  - Radar fraud signals apply per-customer
 *  - Saved payment methods can be reused in the future
 *
 * The Customer ID is stored on the users table as `stripe_id` so subsequent
 * checkouts reuse the same Customer rather than creating duplicates.
 */
class StripeCustomerService
{
    private ?StripeClient $stripe = null;

    public function __construct()
    {
        $secret = Setting::get('settings::modules:billing:keys:secret', config('modules.billing.keys.secret'));
        if ($secret) {
            $this->stripe = new StripeClient([
                'api_key'        => $secret,
                'stripe_version' => '2026-06-24.dahlia',
            ]);
        }
    }

    /**
     * Return the Stripe Customer ID for the given user, creating one if necessary.
     *
     * If the stored `stripe_id` is stale (the Customer was deleted in Stripe),
     * the value is cleared and a fresh Customer is created automatically.
     *
     * @throws BillingExceptionClass if Stripe is not configured or the API call fails
     */
    public function resolveForUser(User $user): string
    {
        $this->ensureInitialized();

        // Fast path: user already has a valid stripe_id
        $replacingCustomerId = null;
        if ($user->stripe_id) {
            // Validate the stored ID is still live in Stripe
            try {
                $customer = $this->stripe->customers->retrieve($user->stripe_id);

                if (!isset($customer->deleted) || !$customer->deleted) {
                    return $user->stripe_id;
                }

                // Retain the stale identifier until its replacement has been
                // persisted. It is part of the replacement idempotency key;
                // clearing it first can replay the original, now-deleted
                // "initial" Customer creation after an ambiguous failure.
                Log::info('Stripe Customer deleted remotely, creating an idempotent replacement', [
                    'user_id' => $user->id,
                    'stripe_id' => $user->stripe_id,
                ]);
                $replacingCustomerId = $user->stripe_id;
            } catch (\Stripe\Exception\InvalidRequestException $e) {
                // Customer not found (e.g. wrong mode sandbox/live) – recreate
                Log::warning('Stripe Customer not found, recreating', [
                    'user_id' => $user->id,
                    'stripe_id' => $user->stripe_id,
                    'stripe_code' => $e->getStripeCode(),
                ]);
                $replacingCustomerId = $user->stripe_id;
            } catch (\Stripe\Exception\ApiErrorException $e) {
                // Non-fatal API error – log and fall through so checkout still works
                Log::error('Failed to validate Stripe Customer, proceeding without customer link', [
                    'user_id' => $user->id,
                    'stripe_id' => $user->stripe_id,
                    'error' => $e->getMessage(),
                ]);

                return $user->stripe_id;
            }
        }

        return $this->createForUser($user, $replacingCustomerId);
    }

    /**
     * Create a new Stripe Customer for the user and persist the ID.
     *
     * @throws BillingExceptionClass
     */
    private function createForUser(User $user, ?string $replacingCustomerId = null): string
    {
        try {
            $customer = $this->stripe->customers->create([
                'metadata' => [
                    'user_id' => (string) $user->id,
                ],
            ], [
                // Concurrent checkouts for the same local user must converge on
                // one provider customer. Include the stale ID when replacing a
                // deleted/mode-mismatched customer so replacement can advance.
                'idempotency_key' => sprintf(
                    'billing-user-%d-%s',
                    $user->id,
                    $replacingCustomerId
                        ? substr(hash('sha256', $replacingCustomerId), 0, 24)
                        : 'initial'
                ),
            ]);

            $customerId = DB::transaction(function () use ($user, $customer, $replacingCustomerId): string {
                /** @var User $locked */
                $locked = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
                if (
                    $locked->stripe_id
                    && $locked->stripe_id !== $replacingCustomerId
                ) {
                    return $locked->stripe_id;
                }

                $locked->forceFill(['stripe_id' => $customer->id])->saveOrFail();

                return $customer->id;
            });

            Log::info('Created Stripe Customer for user', [
                'user_id'     => $user->id,
                'customer_id' => $customerId,
            ]);

            return $customerId;
        } catch (\Stripe\Exception\ApiErrorException $e) {
            Log::error('Failed to create Stripe Customer', [
                'user_id'     => $user->id,
                'error'       => $e->getMessage(),
                'stripe_code' => $e->getStripeCode(),
            ]);

            throw new BillingExceptionClass('Stripe Customer creation failed', 'Failed to create Stripe Customer: ' . $e->getMessage(), BillingException::TYPE_PAYMENT, null, 'stripe', null, ['user_id' => $user->id, 'stripe_error' => $e->getStripeCode()], $e);
        } catch (\Exception $e) {
            Log::error('Unexpected error creating Stripe Customer', [
                'user_id' => $user->id,
                'error'   => $e->getMessage(),
            ]);

            throw new BillingExceptionClass('Stripe Customer creation error', 'An unexpected error occurred while creating Stripe Customer: ' . $e->getMessage(), BillingException::TYPE_PAYMENT, null, 'stripe', null, ['user_id' => $user->id, 'error' => $e->getMessage()], $e);
        }
    }

    /**
     * @throws BillingExceptionClass if Stripe is not configured
     */
    private function ensureInitialized(): void
    {
        if (!$this->stripe) {
            throw new BillingExceptionClass('Stripe is not configured', 'Stripe payment processing is not configured. Please contact support.', BillingException::TYPE_STOREFRONT, null, 'stripe', null, ['configured' => false]);
        }
    }
}
