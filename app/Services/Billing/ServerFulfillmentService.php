<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Log;
use Everest\Models\Billing\CouponUsage;
use Everest\Exceptions\DisplayException;
use Everest\Jobs\Billing\GenerateInvoiceJob;
use Everest\Jobs\CustomDomains\ProvisionServerCustomDomainsJob;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

/**
 * Central server fulfillment service for paid orders.
 *
 * This service centralizes the server creation/renewal logic for all payment processors
 * (Stripe, PayPal). It ensures consistent behavior and reduces code duplication.
 *
 * Key responsibilities:
 * - Idempotency checks to prevent duplicate order processing
 * - Routing to renewal or new server creation based on order type
 * - Recording coupon usage for completed orders
 * - Updating order status after successful fulfillment
 */
class ServerFulfillmentService
{
    public function __construct(
        private CreateServerService $serverCreation,
        private OrderProcessorService $processorService,
        private CustomDomainProvisioningService $customDomainProvisioning,
        private CreateOrderService $orderService,
        private CheckoutReservationService $reservationService,
        private PlanChangeService $planChangeService,
        private CheckoutActivityService $checkoutActivity,
    ) {
    }

    /**
     * Fulfill an order by creating a server or processing a renewal.
     *
     * This method handles the complete fulfillment process:
     * 1. Validates the order hasn't already been processed (idempotency)
     * 2. Creates a new server OR processes a renewal based on order type
     * 3. Records coupon usage if applicable
     * 4. Updates order status to processed
     *
     * The order is claimed atomically before any server or renewal side effect.
     *
     * @param Request $request The HTTP request
     * @param Order $order The order to fulfill
     *
     * @return Server The created or renewed server
     *
     * @throws DisplayException if order is already processed or fulfillment fails
     */
    public function fulfillOrder(Request $request, Order $order, ?object $paymentMetadata = null): Server
    {
        if (
            $order->payment_processor !== 'free'
            && !$order->transaction()
                ->where(function ($query): void {
                    $query->whereNotNull('capture_id')->orWhereNotNull('captured_at');
                })
                ->exists()
        ) {
            throw new DisplayException('Provider-backed orders require durable capture evidence before fulfillment.');
        }

        return $this->executeFulfillment($request, $order, null);
    }

    /**
     * Fulfill a Stripe order, capturing before any entitlement side effect.
     */
    public function fulfillStripeOrder(
        Request $request,
        Order $order,
        callable $capturePayment,
        bool $providerAlreadyCaptured,
    ): Server {
        return $this->executeFulfillment(
            $request,
            $order,
            $capturePayment,
            $providerAlreadyCaptured,
        );
    }

    public function fulfillPayPalOrder(
        Request $request,
        Order $order,
        callable $capturePayment,
        bool $providerAlreadyCaptured,
    ): Server {
        return $this->executeFulfillment(
            $request,
            $order,
            $capturePayment,
            $providerAlreadyCaptured,
        );
    }

    private function executeFulfillment(
        Request $request,
        Order $order,
        ?callable $capturePayment,
        bool $providerAlreadyCaptured = false,
    ): Server {
        [$claimedOrder, $alreadyProcessed, $staleReclaim] = $this->claim($order);
        if ($alreadyProcessed) {
            return Server::query()->findOrFail($claimedOrder->server_id);
        }

        $server = null;
        $captureRecorded = $claimedOrder->transaction()
            ->where(function ($query): void {
                $query->whereNotNull('capture_id')->orWhereNotNull('captured_at');
            })
            ->exists();
        $captureAttempted = $claimedOrder->payment_processor !== 'free'
            && ($capturePayment === null || $providerAlreadyCaptured || $captureRecorded || $staleReclaim);

        try {
            // On crash recovery, provider success can predate our local capture
            // record. Persist that durable financial truth before any mutable
            // product lookup or preflight is allowed to fail and misclassify
            // the order.
            if ($capturePayment !== null && $providerAlreadyCaptured) {
                $this->assertClaim($claimedOrder);
                $capturePayment();
                $capturePayment = null;
            }

            $product = Product::findOrFail($claimedOrder->product_id);
            Log::info("Fulfilling claimed order {$claimedOrder->id} of type {$claimedOrder->type}");

            $this->preflight($claimedOrder, $product);

            // Capture every provider-backed payment before provisioning or
            // changing an entitlement. Ambiguous provider outcomes remain in
            // the durable fulfilling state for reconciliation.
            if ($capturePayment !== null) {
                $this->assertClaim($claimedOrder);
                $captureAttempted = true;
                $capturePayment();
            }

            $this->assertClaim($claimedOrder);
            if ($claimedOrder->type === Order::TYPE_REN) {
                $server = $this->processRenewal($claimedOrder, $product);
                $completedOrder = $claimedOrder->fresh();
                if ($completedOrder->status !== Order::STATUS_PROCESSED) {
                    throw new DisplayException('The renewal did not complete atomically.');
                }
            } elseif ($claimedOrder->type === Order::TYPE_UPG) {
                $server = $this->planChangeService->fulfillPaidUpgrade($claimedOrder, $product);
                $completedOrder = $claimedOrder->fresh();
                if ($completedOrder->status !== Order::STATUS_PROCESSED) {
                    throw new DisplayException('The paid plan change did not complete atomically.');
                }
            } else {
                $server = $claimedOrder->server_id
                    ? Server::query()->findOrFail($claimedOrder->server_id)
                    : $this->processNewServer($request, $claimedOrder, $product);
                $completedOrder = $this->complete($claimedOrder, $server);
            }

            $this->dispatchPaymentReceivedEmail($completedOrder, $product);
            $this->checkoutActivity->recordFulfilled($completedOrder, $server);

            Log::info("Successfully fulfilled order {$completedOrder->id}, server {$server->id}");

            return $server;
        } catch (\Throwable $exception) {
            $hasProvisioningSideEffect = !in_array(
                $claimedOrder->type,
                [Order::TYPE_REN, Order::TYPE_UPG],
                true
            )
                && $this->hasLinkedServer($claimedOrder);
            if (!$captureAttempted && !$hasProvisioningSideEffect) {
                $this->failClaimAndRelease($claimedOrder);
            } else {
                Log::critical('Payment fulfillment requires reconciliation', [
                    'order_id' => $claimedOrder->id,
                    'capture_attempted' => $captureAttempted,
                    'server_id' => $claimedOrder->fresh()->server_id,
                    'error' => $exception->getMessage(),
                ]);
            }
            Log::error("Failed to fulfill order {$claimedOrder->id}: " . $exception->getMessage());
            throw $exception;
        }
    }

    /**
     * @return array{0: Order, 1: bool, 2: bool}
     */
    private function claim(Order $order): array
    {
        return DB::transaction(function () use ($order) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            if ($locked->status === Order::STATUS_PROCESSED) {
                if (!$locked->server_id) {
                    throw new DisplayException('The processed order is missing its server.');
                }

                return [$locked, true, false];
            }

            $staleReclaim = false;
            if ($locked->status === Order::STATUS_FULFILLING) {
                if (
                    $locked->fulfillment_started_at
                    && $locked->fulfillment_started_at->isAfter(now()->subMinutes(15))
                ) {
                    throw new DisplayException('This order is already being processed.');
                }

                // A linked server means another worker has crossed the local
                // provisioning boundary and may still be waiting on the daemon.
                // Never steal that lease automatically: doing so could complete
                // or delete a server still owned by the original worker.
                if (
                    !in_array($locked->type, [Order::TYPE_REN, Order::TYPE_UPG], true)
                    && $locked->server_id !== null
                ) {
                    throw new DisplayException('This provisioning attempt requires manual reconciliation.');
                }

                Log::warning('Reclaiming stale payment fulfillment', [
                    'order_id' => $locked->id,
                    'previous_claim' => $locked->fulfillment_claim,
                ]);
                $staleReclaim = true;
            }

            if (!in_array($locked->status, [Order::STATUS_PENDING, Order::STATUS_FULFILLING], true)) {
                throw new DisplayException('This order cannot be processed in its current state.');
            }

            if (!$locked->checkout_locked_at || !$locked->checkout_fingerprint) {
                throw new DisplayException('This checkout has not been finalized.');
            }

            $locked->forceFill([
                'status' => Order::STATUS_FULFILLING,
                'fulfillment_started_at' => now(),
                'fulfillment_claim' => Str::uuid()->toString(),
            ])->saveOrFail();

            return [$locked, false, $staleReclaim];
        });
    }

    private function complete(Order $order, Server $server): Order
    {
        return DB::transaction(function () use ($order, $server) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== Order::STATUS_FULFILLING) {
                throw new DisplayException('The fulfillment claim is no longer active.');
            }
            if (!hash_equals((string) $locked->fulfillment_claim, (string) $order->fulfillment_claim)) {
                throw new DisplayException('A newer fulfillment attempt owns this order.');
            }

            if ($locked->coupon_id) {
                $this->recordCouponUsage($locked);
            }
            $this->reservationService->consume($locked, $server);

            $locked->forceFill([
                'status' => Order::STATUS_PROCESSED,
                'server_id' => $server->id,
                'fulfillment_claim' => null,
            ])->saveOrFail();

            return $locked;
        });
    }

    private function failClaimAndRelease(Order $order): void
    {
        $this->reservationService->transitionAndRelease(
            $order,
            Order::STATUS_FULFILLING,
            Order::STATUS_FAILED,
            $order->fulfillment_claim,
            'failed',
        );
    }

    private function hasLinkedServer(Order $order): bool
    {
        return Order::query()->whereKey($order->id)->whereNotNull('server_id')->exists();
    }

    private function assertClaim(Order $order): void
    {
        if (
            !Order::query()
                ->whereKey($order->id)
                ->where('status', Order::STATUS_FULFILLING)
                ->where('fulfillment_claim', $order->fulfillment_claim)
                ->exists()
        ) {
            throw new DisplayException('A newer fulfillment attempt owns this order.');
        }
    }

    private function preflight(Order $order, Product $product): void
    {
        if ($order->type === Order::TYPE_REN) {
            $server = Server::query()->findOrFail($order->server_id);
            if (
                (int) $server->owner_id !== (int) $order->user_id
                || (int) $server->billing_product_id !== (int) $product->id
                || $server->isDeletionScheduled()
            ) {
                throw new DisplayException('This server can no longer be renewed by this order.');
            }

            return;
        }

        if ($order->type === Order::TYPE_UPG) {
            $this->planChangeService->preflightPaidUpgrade($order, $product);

            return;
        }

        if ($order->server_id === null) {
            $this->serverCreation->preflight($product, $order);
        }
    }

    /**
     * Process a renewal order.
     *
     * @param Order $order The renewal order
     * @param Product $product The product to renew with
     *
     * @return Server The renewed server
     *
     * @throws DisplayException if server ID is missing
     */
    private function processRenewal(Order $order, Product $product): Server
    {
        // For renewals, get the server from the stored server_id
        if (!$order->server_id) {
            throw new DisplayException('Server ID not found in order record for renewal.');
        }

        $server = Server::findOrFail($order->server_id);

        // Get billing days from the order, or fall back to server's billing_days, or default from settings
        $billingDays = $order->billing_days ?? $server->billing_days ?? BillingDefaults::defaultBillingDays();

        // Use the unified processor service for renewal
        $result = $this->processorService->processRenewal(
            $server,
            $product,
            $order->coupon_id,
            $billingDays,
            $order
        );

        Log::info("Completed server renewal for order {$order->id}, server {$server->id}");

        return $result['server'];
    }

    /**
     * Process a new server order.
     *
     * @param Request $request The HTTP request
     * @param Order $order The new server order
     * @param Product $product The product being purchased
     *
     * @return Server The created server
     */
    private function processNewServer(Request $request, Order $order, Product $product): Server
    {
        // Set the user resolver to the order owner
        // This is needed when called from webhooks where there's no authenticated user
        $user = \Everest\Models\User::findOrFail($order->user_id);
        $request->setUserResolver(function () use ($user) {
            return $user;
        });

        // Fulfillment truth comes exclusively from the locked local snapshot.
        $metadata = $this->buildMetadata($order);

        // Create the server using the centralized creation service
        $server = $this->serverCreation->process($request, $product, $metadata, $order);

        try {
            $this->customDomainProvisioning->syncFromOrder($server, $order);
            ProvisionServerCustomDomainsJob::dispatch($server->id);
        } catch (\Throwable $exception) {
            // Optional domain setup must not roll back a captured core server
            // entitlement. Operators can retry domain provisioning separately.
            Log::warning('Custom domain provisioning deferred after server fulfillment', [
                'order_id' => $order->id,
                'server_id' => $server->id,
                'error' => $exception->getMessage(),
            ]);
        }

        Log::info("Created new server {$server->id} for order {$order->id}");

        return $server;
    }

    /**
     * Build metadata object for server creation.
     *
     * Provider metadata is only a reconciliation reference. It is never an
     * alternate source of server limits or fulfillment fields.
     *
     * @param Order $order The order containing server creation data
     *
     * @return object Metadata object with required fields
     */
    private function buildMetadata(Order $order): object
    {
        return (object) [
            'product_id' => $order->product_id,
            'node_id' => $order->node_id,
            'egg_id' => $order->egg_id,
            'name' => $order->name,
            'variables' => $order->variables ?? [],
            'billing_days' => $order->billing_days ?? BillingDefaults::defaultBillingDays(),
        ];
    }

    /**
     * Record coupon usage for an order.
     *
     * Uses firstOrCreate to be idempotent and avoid race conditions.
     *
     * @param Order $order The order to record coupon usage for
     */
    private function recordCouponUsage(Order $order): void
    {
        // Use firstOrCreate for idempotent coupon usage recording
        CouponUsage::query()
            ->where('order_id', $order->id)
            ->where('status', 'reserved')
            ->update([
                'status' => 'consumed',
                'expires_at' => null,
                'used_at' => now(),
            ]);

        Log::info("Recorded coupon usage for order {$order->id}");
    }

    /**
     * Fulfill a free order by creating a new server.
     *
     * This consolidates the free checkout path previously handled by
     * OrderProcessorService::createServerOrder(). CheckoutController::processFree()
     * calls this instead of going through OrderProcessorService.
     *
     * @return array{server: Server, order: Order}
     */
    public function fulfillFreeOrder(
        Request $request,
        \Everest\Models\User $user,
        Product $product,
        int $nodeId,
        int $eggId,
        ?int $couponId = null,
        array $variables = [],
        ?string $paymentIntentId = null,
        ?string $serverName = null,
        int $billingDays = 0,
        array $domainPayload = [],
    ): array {
        if ($billingDays <= 0) {
            $billingDays = BillingDefaults::defaultBillingDays();
        }

        $order = $this->orderService->create(
            $paymentIntentId,
            $user,
            $product,
            Order::STATUS_PENDING,
            Order::TYPE_NEW,
            $couponId,
            $eggId,
            [
                'billing_days'   => $billingDays,
                'name'           => $serverName,
                'domain_payload' => $domainPayload,
            ]
        );

        $server = null;
        try {
            $server = $this->serverCreation->processFree(
                $request,
                $product,
                $nodeId,
                $order,
                $variables,
                $serverName
            );

            DB::transaction(function () use ($order, $server): void {
                /** @var Order $locked */
                $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
                $this->reservationService->consume($locked, $server);
                $locked->forceFill([
                    'status' => Order::STATUS_PROCESSED,
                    'server_id' => $server->id,
                ])->saveOrFail();
            });
        } catch (\Throwable $exception) {
            if ($server === null) {
                $this->reservationService->transitionAndRelease(
                    $order,
                    Order::STATUS_PENDING,
                    Order::STATUS_FAILED,
                );
            } else {
                Log::critical('Free server fulfillment requires reconciliation', [
                    'order_id' => $order->id,
                    'server_id' => $server->id,
                    'error' => $exception->getMessage(),
                ]);
            }
            throw $exception;
        }

        $this->checkoutActivity->recordFulfilled($order->refresh(), $server);

        try {
            $this->customDomainProvisioning->syncFromOrder($server, $order);
            ProvisionServerCustomDomainsJob::dispatch($server->id);
        } catch (\Throwable $exception) {
            // Custom domains are an optional post-provisioning feature. They
            // cannot make a successfully created free server re-claimable.
            Log::warning('Custom domain provisioning deferred after free server fulfillment', [
                'order_id' => $order->id,
                'server_id' => $server->id,
                'error' => $exception->getMessage(),
            ]);
        }

        return ['server' => $server, 'order' => $order];
    }

    /**
     * Dispatch a PaymentFailed email event.
     */
    public function dispatchPaymentFailedEmail(Order $order, string $reason, string $processor): void
    {
        try {
            $user = $order->user;
            if (!$user) {
                Log::warning("Cannot dispatch PaymentFailed email for order {$order->id}: user not found");

                return;
            }

            $currency = $order->checkout_currency
                ?? config('modules.billing.currency.code', 'USD');
            $product = Product::find($order->product_id);
            $amount = (float) ($order->total ?? ($product ? $product->price : 0));
            $isRenewal = $order->type === Order::TYPE_REN;

            event(new \Everest\Events\Email\PaymentFailed(
                user: $user,
                amount: $amount,
                currency: $currency,
                reason: $reason,
                invoiceId: (string) $order->id,
                correlationId: Str::uuid()->toString(),
                paymentMethod: ucfirst($processor),
                isRenewal: $isRenewal,
            ));

            Log::info("Dispatched PaymentFailed email for order {$order->id}");
        } catch (\Exception $e) {
            Log::error("Failed to dispatch PaymentFailed email for order {$order->id}: " . $e->getMessage());
        }
    }

    /**
     * Dispatch PaymentReceived email event after successful order fulfillment.
     *
     * @param Order $order The completed order
     * @param Product $product The product associated with the order
     */
    private function dispatchPaymentReceivedEmail(Order $order, Product $product): void
    {
        try {
            $user = $order->user;
            if (!$user) {
                Log::warning("Cannot dispatch PaymentReceived email for order {$order->id}: user not found");

                return;
            }

            // Get currency from config
            $currency = $order->checkout_currency
                ?? config('modules.billing.currency.code', 'USD');

            // Determine payment method
            $paymentMethod = match ($order->payment_processor) {
                'paypal' => 'PayPal',
                'stripe' => 'Stripe',
                'free' => 'Free',
                default => 'Unknown',
            };

            // Get coupon info if applicable
            $couponCode = null;
            $originalAmount = null;
            $discountAmount = null;

            if ($order->coupon_id) {
                $coupon = \Everest\Models\Billing\Coupon::find($order->coupon_id);
                if ($coupon) {
                    $couponCode = $coupon->code;
                    $finalAmount = $order->total;
                    if ($coupon->type === 'percent') {
                        $originalAmount = $finalAmount / (1 - ($coupon->value / 100));
                        $discountAmount = $originalAmount - $finalAmount;
                    } else {
                        $originalAmount = $finalAmount + $coupon->value;
                        $discountAmount = $coupon->value;
                    }
                }
            }

            $isRenewal = $order->type === Order::TYPE_REN;
            $billingDays = $order->billing_days ?? null;
            $correlationId = Str::uuid()->toString();

            // Dispatch the invoice generation job which will generate the PDF
            // and then fire the PaymentReceived email event.
            GenerateInvoiceJob::dispatch(
                orderId: $order->id,
                amount: $order->total,
                currency: $currency,
                paymentMethod: $paymentMethod,
                correlationId: $correlationId,
                isRenewal: $isRenewal,
                originalAmount: $originalAmount,
                discountAmount: $discountAmount,
                couponCode: $couponCode,
                billingDays: $billingDays,
            );

            Log::info("Dispatched GenerateInvoiceJob for order {$order->id}");
        } catch (\Exception $e) {
            // Don't fail the order if invoice/email dispatch fails
            Log::error("Failed to dispatch GenerateInvoiceJob for order {$order->id}: " . $e->getMessage());
        }
    }
}
