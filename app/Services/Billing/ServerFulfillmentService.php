<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
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
     * IMPORTANT: Server creation must be committed BEFORE calling Wings to ensure
     * the server exists in the database when Wings calls back to fetch configuration.
     * We use optimistic concurrency control to prevent duplicate processing.
     *
     * @param Request $request The HTTP request
     * @param Order $order The order to fulfill
     * @param object|null $paymentMetadata Optional metadata from payment processor (Stripe, PayPal)
     *
     * @return Server The created or renewed server
     *
     * @throws DisplayException if order is already processed or fulfillment fails
     */
    public function fulfillOrder(Request $request, Order $order, ?object $paymentMetadata = null): Server
    {
        // Refresh order to get latest status
        $order->refresh();

        // Idempotency check: if order is already processed, don't process again
        // This is a normal scenario in concurrent webhook/payment systems
        if ($order->status === Order::STATUS_PROCESSED) {
            Log::info("Order {$order->id} already processed - idempotency check prevented duplicate processing");
            throw new DisplayException('This order has already been processed.');
        }

        try {
            $product = Product::findOrFail($order->product_id);

            Log::info("Fulfilling order {$order->id} of type {$order->type}");

            // Create server or process renewal
            // ServerCreationService has its own transaction that will be committed
            // BEFORE calling Wings, ensuring the server exists when Wings calls back
            if ($order->type === Order::TYPE_REN) {
                // RENEWAL: Use existing server
                $server = $this->processRenewal($order, $product);
            } else {
                // NEW SERVER: Create new server
                $server = $this->processNewServer($request, $order, $product, $paymentMetadata);
            }

            // Update order status and record coupon usage
            // Use a transaction for atomicity, but this is AFTER server creation
            DB::beginTransaction();
            try {
                // Optimistic concurrency control: fetch fresh order instance
                // This ensures we're working with the latest data and prevents race conditions
                $currentOrder = Order::where('id', $order->id)->firstOrFail();

                if ($currentOrder->status === Order::STATUS_PROCESSED) {
                    DB::rollBack();
                    Log::info("Order {$currentOrder->id} was processed by another request during fulfillment");

                    // Server is created, order is marked processed - this is OK
                    return $server;
                }

                // Record coupon usage for non-renewal orders
                // (Renewals are handled by OrderProcessorService)
                // Use $currentOrder (fresh instance) to ensure we're working with latest data
                if ($currentOrder->type !== Order::TYPE_REN && $currentOrder->coupon_id) {
                    $this->recordCouponUsage($currentOrder);
                }

                // Mark the order as processed (only for non-renewal orders)
                // Renewal orders maintain their own status lifecycle
                // Use $currentOrder (fresh instance) to ensure update operates on latest data
                if ($currentOrder->type !== Order::TYPE_REN) {
                    $currentOrder->update([
                        'status'    => Order::STATUS_PROCESSED,
                        'server_id' => $server->id,
                    ]);
                }

                DB::commit();

                // Dispatch PaymentReceived email event after successful fulfillment
                $this->dispatchPaymentReceivedEmail($currentOrder, $product);
            } catch (\Exception $e) {
                DB::rollBack();
                Log::error("Failed to update order status for order {$order->id}: " . $e->getMessage());
                // Server is created successfully, but order status update failed
                // This is not critical - the server exists and can be used
                // Log the error but don't throw - return the server
                Log::warning("Order {$order->id} - server {$server->id} created successfully, but status update failed. Manual intervention may be needed.");
            }

            Log::info("Successfully fulfilled order {$order->id}, server {$server->id}");

            return $server;
        } catch (\Exception $e) {
            Log::error("Failed to fulfill order {$order->id}: " . $e->getMessage());
            throw $e;
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
        $result = $this->processorService->processRenewal($server, $product, $order->coupon_id, $billingDays);

        Log::info("Completed server renewal for order {$order->id}, server {$server->id}");

        return $result['server'];
    }

    /**
     * Process a new server order.
     *
     * @param Request $request The HTTP request
     * @param Order $order The new server order
     * @param Product $product The product being purchased
     * @param object|null $paymentMetadata Optional metadata from payment processor
     *
     * @return Server The created server
     */
    private function processNewServer(Request $request, Order $order, Product $product, ?object $paymentMetadata = null): Server
    {
        // Set the user resolver to the order owner
        // This is needed when called from webhooks where there's no authenticated user
        $user = \Everest\Models\User::findOrFail($order->user_id);
        $request->setUserResolver(function () use ($user) {
            return $user;
        });

        // Build metadata object from order data or payment metadata
        $metadata = $this->buildMetadata($order, $paymentMetadata);

        // Create the server using the centralized creation service
        $server = $this->serverCreation->process($request, $product, $metadata, $order);

        $this->customDomainProvisioning->syncFromOrder($server, $order);
        ProvisionServerCustomDomainsJob::dispatch($server->id);

        Log::info("Created new server {$server->id} for order {$order->id}");

        return $server;
    }

    /**
     * Build metadata object for server creation.
     *
     * Prefers payment metadata if available (Stripe), otherwise uses order data (PayPal).
     *
     * @param Order $order The order containing server creation data
     * @param object|null $paymentMetadata Optional metadata from payment processor
     *
     * @return object Metadata object with required fields
     */
    private function buildMetadata(Order $order, ?object $paymentMetadata = null): object
    {
        // If payment metadata is provided (Stripe), use it
        if ($paymentMetadata !== null) {
            // Create a copy to avoid modifying the original
            $metadata = clone $paymentMetadata;

            // Decode variables if they're JSON encoded
            if (isset($metadata->variables) && !empty($metadata->variables)) {
                if (is_string($metadata->variables)) {
                    $metadata->variables = json_decode($metadata->variables, true) ?? [];
                }
            }

            return $metadata;
        }

        // Otherwise, build from order data (PayPal)
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
        CouponUsage::firstOrCreate(
            ['order_id' => $order->id],
            [
                'coupon_id' => $order->coupon_id,
                'user_id' => $order->user_id,
                'used_at' => now(),
            ]
        );

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

        $server = $this->serverCreation->processFree(
            $request,
            $product,
            $nodeId,
            $order,
            $variables,
            $serverName
        );

        $this->customDomainProvisioning->syncFromOrder($server, $order);
        ProvisionServerCustomDomainsJob::dispatch($server->id);

        if ($couponId) {
            CouponUsage::firstOrCreate(
                ['coupon_id' => $couponId, 'user_id' => $user->id, 'order_id' => $order->id],
                ['used_at' => now()]
            );
        }

        $order->update([
            'status'    => Order::STATUS_PROCESSED,
            'server_id' => $server->id,
        ]);

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

            $currency = config('modules.billing.currency.code', 'USD');
            $product = Product::find($order->product_id);
            $amount = (float) ($order->total ?? ($product ? $product->price : 0));
            $isRenewal = $order->type === Order::TYPE_REN;

            event(new \Everest\Events\Email\PaymentFailed(
                user: $user,
                amount: $amount,
                currency: $currency,
                reason: $reason,
                invoiceId: (string) $order->id,
                correlationId: \Illuminate\Support\Str::uuid()->toString(),
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
            $currency = config('modules.billing.currency.code', 'USD');

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
            $correlationId = \Illuminate\Support\Str::uuid()->toString();

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
