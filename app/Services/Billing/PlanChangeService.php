<?php

namespace Everest\Services\Billing;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Log;
use Everest\Models\Billing\Category;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\PaymentTransaction;
use Everest\Repositories\Wings\DaemonServerRepository;
use Everest\Services\Servers\BuildModificationService;

/**
 * Quotes and applies billing plan changes without granting resources before
 * an upgrade is paid or before a scheduled downgrade reaches renewal.
 */
class PlanChangeService
{
    private const SECONDS_PER_DAY = 86400;

    private const UNSUPPORTED_CURRENCIES = [
        'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
        'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
        'HUF', 'TWD', 'BHD', 'JOD', 'KWD', 'OMR', 'TND',
    ];

    public function __construct(
        private BuildModificationService $buildModificationService,
        private DaemonServerRepository $daemonRepository,
        private FreeProductEntitlementService $entitlementService,
        private ?BillingCycleService $billingCycleService = null,
    ) {
    }

    /**
     * Return a server-authoritative prorated quote.
     *
     * The server's existing renewal date and billing cycle are always retained.
     * Positive differences must be paid now. Zero/negative differences are
     * scheduled for the existing renewal date and do not issue an automatic refund.
     *
     * @return array<string, mixed>
     */
    public function quote(Server $server, Product $newProduct): array
    {
        $currentProduct = $this->currentProduct($server);
        $freshTarget = Product::query()->findOrFail($newProduct->id);

        if (!hash_equals($this->productStateHash($newProduct, $server), $this->productStateHash($freshTarget, $server))) {
            throw new DisplayException('The selected plan changed while its resource limits were being validated. Review the updated plan and try again.');
        }

        return $this->buildQuote($server, $currentProduct, $freshTarget, true);
    }

    /**
     * Backwards-compatible entry point. Direct, immediate plan application is
     * deliberately disabled: paid changes require checkout and non-positive
     * changes are scheduled for renewal.
     */
    public function changePlan(Server $server, Product $newProduct, bool $force = false, ?int $billingDays = null): Server
    {
        if ($force) {
            throw new DisplayException('Plan-change resource validation cannot be bypassed.');
        }
        if ($billingDays !== null && (int) $server->billing_days !== $billingDays) {
            throw new DisplayException('A plan change cannot alter the server billing cycle.');
        }

        $quote = $this->quote($server, $newProduct);
        if ((int) $quote['charge_minor'] > 0) {
            throw new DisplayException('Payment is required before this plan change can be applied.');
        }

        return $this->scheduleChange($server, $newProduct);
    }

    /**
     * Schedule a zero-cost or lower-priced change for the current renewal date.
     */
    public function scheduleChange(Server $server, Product $newProduct): Server
    {
        return DB::transaction(function () use ($server, $newProduct): Server {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();
            $this->assertNoConflictingOrders($lockedServer);
            [$currentProduct, $targetProduct] = $this->lockProducts($lockedServer, $newProduct->id);
            $quote = $this->buildQuote($lockedServer, $currentProduct, $targetProduct, true);

            if ((int) $quote['charge_minor'] > 0) {
                throw new DisplayException('Payment is required before this plan change can be applied.');
            }
            if ($lockedServer->pending_plan_change_order_id !== null) {
                throw new DisplayException('A paid plan change is already pending for this server.');
            }

            $lockedServer->forceFill([
                'scheduled_billing_product_id' => $targetProduct->id,
                'scheduled_plan_change_at' => $lockedServer->renewal_date,
                'scheduled_plan_change_snapshot' => $quote,
                'scheduled_plan_change_retry_at' => null,
                'scheduled_plan_change_last_error' => null,
            ])->saveOrFail();

            return $lockedServer->refresh();
        }, 5);
    }

    public function scheduleDowngrade(Server $server, Product $newProduct): Server
    {
        return $this->scheduleChange($server, $newProduct);
    }

    /**
     * Cancel a scheduled change. Paid checkout reservations are intentionally
     * separate and cannot be cancelled through this method.
     */
    public function cancelScheduledChange(Server $server): Server
    {
        return DB::transaction(function () use ($server): Server {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();
            $lockedServer->forceFill([
                'scheduled_billing_product_id' => null,
                'scheduled_plan_change_at' => null,
                'scheduled_plan_change_snapshot' => null,
                'scheduled_plan_change_retry_at' => null,
                'scheduled_plan_change_last_error' => null,
            ])->saveOrFail();

            return $lockedServer->refresh();
        }, 5);
    }

    /**
     * Reserve a provider-backed upgrade against one server. The checkout
     * snapshot may age naturally, but all entitlement and price inputs must
     * still match and the originally quoted amount may never undercharge the
     * current prorated amount.
     */
    public function reservePaidUpgrade(Order $order, array $snapshot): Server
    {
        if ($order->server_id === null) {
            throw new DisplayException('A plan-change order must identify a server.');
        }

        return DB::transaction(function () use ($order, $snapshot): Server {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($order->server_id)->lockForUpdate()->firstOrFail();
            [$currentProduct, $targetProduct] = $this->lockProducts($lockedServer, (int) $order->product_id);
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $this->assertNoConflictingOrders($lockedServer, $lockedOrder->id);

            if (
                $lockedOrder->status !== Order::STATUS_PENDING
                || $lockedOrder->type !== Order::TYPE_UPG
                || (int) $lockedOrder->server_id !== (int) $lockedServer->id
                || (int) $lockedOrder->user_id !== (int) $lockedServer->owner_id
                || (int) $lockedOrder->product_id !== (int) $targetProduct->id
                || (int) $lockedOrder->source_product_id !== (int) $currentProduct->id
            ) {
                throw new DisplayException('The paid plan-change order does not match this server.');
            }
            if (
                $lockedServer->scheduled_billing_product_id !== null
                || $lockedServer->scheduled_plan_change_at !== null
                || $lockedServer->scheduled_plan_change_snapshot !== null
            ) {
                throw new DisplayException('Cancel the scheduled plan change before starting a paid upgrade.');
            }
            if (
                $lockedServer->pending_plan_change_order_id !== null
                && (int) $lockedServer->pending_plan_change_order_id !== (int) $lockedOrder->id
            ) {
                throw new DisplayException('A paid plan change is already pending for this server.');
            }

            $quote = $this->buildQuote($lockedServer, $currentProduct, $targetProduct, true);
            $this->assertPaidSnapshot($lockedOrder, $snapshot, $quote);
            if (!empty($quote['violations'])) {
                throw new DisplayException($this->violationMessage($quote['violations']));
            }

            $lockedServer->pending_plan_change_order_id = $lockedOrder->id;
            $lockedServer->saveOrFail();

            return $lockedServer->refresh();
        }, 5);
    }

    /**
     * Revalidate a claimed upgrade before the provider capture is attempted.
     */
    public function preflightPaidUpgrade(Order $order, Product $product): void
    {
        if ($order->server_id === null) {
            throw new DisplayException('A plan-change order must identify a server.');
        }
        $claim = (string) $order->fulfillment_claim;

        DB::transaction(function () use ($order, $product, $claim): void {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($order->server_id)->lockForUpdate()->firstOrFail();
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $this->assertNoConflictingOrders($lockedServer, $lockedOrder->id);
            /** @var PaymentTransaction|null $transaction */
            $transaction = $lockedOrder->transaction()->lockForUpdate()->first();

            if (
                $lockedOrder->status !== Order::STATUS_FULFILLING
                || $lockedOrder->type !== Order::TYPE_UPG
                || (int) $lockedOrder->server_id !== (int) $lockedServer->id
                || (int) $lockedOrder->user_id !== (int) $lockedServer->owner_id
                || (int) $lockedOrder->product_id !== (int) $product->id
                || (int) $lockedOrder->source_product_id !== (int) $lockedServer->billing_product_id
                || (int) $lockedServer->pending_plan_change_order_id !== (int) $lockedOrder->id
                || $claim === ''
                || !hash_equals((string) $lockedOrder->fulfillment_claim, $claim)
                || !is_array($lockedOrder->plan_change_snapshot)
            ) {
                throw new DisplayException('The paid plan-change order does not match this server.');
            }

            if ($this->capturedPaymentState($transaction)) {
                /** @var Product $targetProduct */
                $targetProduct = Product::query()
                    ->whereKey($lockedOrder->product_id)
                    ->lockForUpdate()
                    ->firstOrFail();
                $this->capturedSnapshotProduct(
                    $lockedOrder,
                    $lockedServer,
                    $targetProduct,
                    $transaction
                );

                return;
            }

            $quotedAt = $lockedOrder->plan_change_snapshot['quoted_at'] ?? null;
            try {
                $quoteExpired = !$quotedAt || Carbon::parse($quotedAt)->lt(now()->subMinutes(15));
            } catch (\Throwable) {
                $quoteExpired = true;
            }
            if ($quoteExpired) {
                throw new DisplayException('This plan-change quote has expired. Start a new checkout.');
            }

            [$currentProduct, $targetProduct] = $this->lockProducts($lockedServer, $product->id);
            $quote = $this->buildQuote($lockedServer, $currentProduct, $targetProduct, true);
            $this->assertPaidSnapshot($lockedOrder, $lockedOrder->plan_change_snapshot, $quote);
            if (!empty($quote['violations'])) {
                throw new DisplayException($this->violationMessage($quote['violations']));
            }
        }, 5);
    }

    /**
     * Prevent an old-plan renewal from racing a scheduled or paid change.
     */
    public function assertRenewalAllowed(Server $server): void
    {
        DB::transaction(function () use ($server): void {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();

            if (
                $lockedServer->scheduled_billing_product_id !== null
                || $lockedServer->scheduled_plan_change_at !== null
                || $lockedServer->scheduled_plan_change_snapshot !== null
            ) {
                $message = $lockedServer->scheduled_plan_change_at?->isFuture()
                    ? 'Cancel the scheduled plan change before renewing this server.'
                    : 'The scheduled plan change is due and must be applied before this server can be renewed.';
                throw new DisplayException($message);
            }
            if ($lockedServer->pending_plan_change_order_id !== null) {
                throw new DisplayException('Complete or cancel the pending paid plan change before renewing this server.');
            }

            $pendingUpgrade = Order::query()
                ->where('server_id', $lockedServer->id)
                ->where('type', Order::TYPE_UPG)
                ->whereIn('status', [
                    Order::STATUS_PENDING,
                    Order::STATUS_FULFILLING,
                    Order::STATUS_PAYMENT_REVIEW,
                ])
                ->lockForUpdate()
                ->exists();
            if ($pendingUpgrade) {
                throw new DisplayException('Complete or cancel the pending paid plan change before renewing this server.');
            }
        }, 5);
    }

    /**
     * Fulfill one captured paid upgrade exactly once.
     */
    public function fulfillPaidUpgrade(Order $order, Product $product): Server
    {
        if ($order->server_id === null) {
            throw new DisplayException('A plan-change order must identify a server.');
        }
        $claim = (string) $order->fulfillment_claim;

        return DB::transaction(function () use ($order, $product, $claim): Server {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($order->server_id)->lockForUpdate()->firstOrFail();
            /** @var Order $lockedOrder */
            $lockedOrder = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            /** @var PaymentTransaction|null $transaction */
            $transaction = $lockedOrder->transaction()->lockForUpdate()->first();

            if (
                $lockedOrder->status !== Order::STATUS_FULFILLING
                || $lockedOrder->type !== Order::TYPE_UPG
                || (int) $lockedOrder->server_id !== (int) $lockedServer->id
                || (int) $lockedOrder->user_id !== (int) $lockedServer->owner_id
                || (int) $lockedOrder->product_id !== (int) $product->id
                || (int) $lockedOrder->source_product_id !== (int) $lockedServer->billing_product_id
                || (int) $lockedServer->pending_plan_change_order_id !== (int) $lockedOrder->id
                || $claim === ''
                || !hash_equals((string) $lockedOrder->fulfillment_claim, $claim)
            ) {
                throw new DisplayException('The paid plan-change order does not match this server.');
            }
            if (!is_array($lockedOrder->plan_change_snapshot)) {
                throw new DisplayException('The paid plan-change snapshot is missing.');
            }

            /** @var Product $targetProduct */
            $targetProduct = Product::query()
                ->whereKey($lockedOrder->product_id)
                ->lockForUpdate()
                ->firstOrFail();
            $snapshotProduct = $this->capturedSnapshotProduct(
                $lockedOrder,
                $lockedServer,
                $targetProduct,
                $transaction
            );

            $updatedServer = $this->applyProductLocked($lockedServer, $snapshotProduct, [
                'pending_plan_change_order_id' => null,
                'scheduled_billing_product_id' => null,
                'scheduled_plan_change_at' => null,
                'scheduled_plan_change_snapshot' => null,
                'scheduled_plan_change_retry_at' => null,
                'scheduled_plan_change_last_error' => null,
                'billing_amount' => $this->minorToMajor(
                    (int) $lockedOrder->plan_change_snapshot['target_cycle_minor']
                ),
            ]);

            $lockedOrder->forceFill([
                'status' => Order::STATUS_PROCESSED,
                'fulfillment_claim' => null,
            ])->saveOrFail();

            return $updatedServer;
        }, 5);
    }

    /**
     * Apply one due scheduled change. It is safe to call repeatedly: after the
     * first success the schedule fields are cleared and later calls are no-ops.
     */
    public function applyDueScheduledChange(int|Server $server): ?Server
    {
        $serverId = $server instanceof Server ? $server->id : $server;

        return DB::transaction(function () use ($serverId): ?Server {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($serverId)->lockForUpdate()->firstOrFail();

            if (
                $lockedServer->scheduled_billing_product_id === null
                || $lockedServer->scheduled_plan_change_at === null
                || $lockedServer->scheduled_plan_change_at->isFuture()
                || $lockedServer->scheduled_plan_change_retry_at?->isFuture()
            ) {
                return null;
            }
            if ($lockedServer->pending_plan_change_order_id !== null) {
                throw new DisplayException('A paid plan change conflicts with this scheduled change.');
            }

            [$currentProduct, $targetProduct] = $this->lockProducts(
                $lockedServer,
                (int) $lockedServer->scheduled_billing_product_id
            );
            $this->assertScheduledSnapshot($lockedServer, $currentProduct, $targetProduct);
            $this->validatePolicy($lockedServer, $currentProduct, $targetProduct, false);
            $violations = $this->resourceViolations($lockedServer, $targetProduct);
            if (!empty($violations)) {
                throw new DisplayException($this->violationMessage($violations));
            }

            $targetMinor = $this->cyclePriceMinor($targetProduct, (int) $lockedServer->billing_days, (int) $lockedServer->node_id);

            return $this->applyProductLocked($lockedServer, $targetProduct, [
                'scheduled_billing_product_id' => null,
                'scheduled_plan_change_at' => null,
                'scheduled_plan_change_snapshot' => null,
                'scheduled_plan_change_retry_at' => null,
                'scheduled_plan_change_last_error' => null,
                'billing_amount' => $this->minorToMajor($targetMinor),
            ]);
        }, 5);
    }

    /**
     * Validate current usage against a target plan.
     *
     * @return array<string, array{current: int|float, limit: int|float, unit: string}>
     */
    public function validatePlanDowngrade(Server $server, Product $newProduct): array
    {
        return $this->resourceViolations($server, $newProduct);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildQuote(
        Server $server,
        Product $currentProduct,
        Product $targetProduct,
        bool $requireFutureRenewal,
    ): array {
        $this->validatePolicy($server, $currentProduct, $targetProduct, $requireFutureRenewal);

        $billingDays = (int) $server->billing_days;
        $nodeId = (int) $server->node_id;
        $currentMinor = $this->cyclePriceMinor($currentProduct, $billingDays, $nodeId);
        $targetMinor = $this->cyclePriceMinor($targetProduct, $billingDays, $nodeId);
        $cycleSeconds = $billingDays * self::SECONDS_PER_DAY;
        $remainingSeconds = max(0, (int) now()->diffInSeconds($server->renewal_date, false));
        $differenceMinor = $targetMinor - $currentMinor;
        $chargeMinor = $differenceMinor > 0
            ? intdiv(($differenceMinor * $remainingSeconds) + intdiv($cycleSeconds, 2), $cycleSeconds)
            : 0;
        if ($chargeMinor > 0 && $remainingSeconds <= (15 * 60)) {
            throw new DisplayException('This server is too close to renewal for a safe prorated upgrade. Renew it first, then request a new plan-change quote.');
        }
        $violations = $this->resourceViolations($server, $targetProduct);
        $currency = $this->currency();
        $sourceState = $this->productState($currentProduct, $server, $currentMinor);
        $targetState = $this->productState($targetProduct, $server, $targetMinor);

        return [
            'mode' => $chargeMinor > 0 ? 'pay_now' : 'scheduled',
            'currency' => $currency,
            'current_cycle_minor' => $currentMinor,
            'target_cycle_minor' => $targetMinor,
            'charge_minor' => $chargeMinor,
            'current_cycle_amount' => $this->minorToMajor($currentMinor),
            'target_cycle_amount' => $this->minorToMajor($targetMinor),
            'charge_amount' => $this->minorToMajor($chargeMinor),
            'remaining_seconds' => $remainingSeconds,
            'renewal_date' => $server->renewal_date->toIso8601String(),
            'renewal_date_raw' => (string) $server->getRawOriginal('renewal_date'),
            'quoted_at' => now()->toIso8601String(),
            'billing_days' => $billingDays,
            'node_id' => $nodeId,
            'server_id' => (int) $server->id,
            'source_product_id' => (int) $currentProduct->id,
            'target_product_id' => (int) $targetProduct->id,
            'source_state' => $sourceState,
            'target_state' => $targetState,
            'source_state_hash' => $this->stateHash($sourceState),
            'target_state_hash' => $this->stateHash($targetState),
            'violations' => $violations,
            'valid' => $chargeMinor === 0 || empty($violations),
        ];
    }

    private function validatePolicy(
        Server $server,
        Product $currentProduct,
        Product $targetProduct,
        bool $requireFutureRenewal,
    ): void {
        if ((int) $currentProduct->id === (int) $targetProduct->id) {
            throw new DisplayException('The selected plan is already active on this server.');
        }
        if ($currentProduct->category_uuid !== $targetProduct->category_uuid) {
            throw new DisplayException('Cannot change to a plan in a different category.');
        }
        /** @var Category|null $category */
        $category = Category::query()->where('uuid', $targetProduct->category_uuid)->first();
        if (!$category || !$category->allow_plan_changes) {
            throw new DisplayException('Plan changes are not allowed for this category.');
        }
        if (array_key_exists('visible', $targetProduct->getAttributes()) && !$targetProduct->visible) {
            throw new DisplayException('The selected plan is not currently available.');
        }
        if (!$server->renewal_date) {
            throw new DisplayException('Server must have a renewal date to change plans.');
        }
        if ($requireFutureRenewal && !$server->renewal_date->isFuture()) {
            throw new DisplayException('Renew this server before changing its plan.');
        }
        if ((int) $server->billing_days < 1) {
            throw new DisplayException('The server does not have a valid billing cycle.');
        }

        $this->cycles()->validateBillingCycle($targetProduct, (int) $server->billing_days);
        $this->assertCooldown($server);
    }

    private function assertCooldown(Server $server): void
    {
        $cooldownHours = (int) Setting::get('settings::modules:billing:plan_change_cooldown_hours', 72);
        if ($cooldownHours <= 0 || !$server->last_plan_change_at) {
            return;
        }

        $hoursSinceLastChange = Carbon::parse($server->last_plan_change_at)->diffInHours(now());
        if ($hoursSinceLastChange < $cooldownHours) {
            $hoursRemaining = max(1, (int) ceil($cooldownHours - $hoursSinceLastChange));
            throw new DisplayException("Plan changes are limited to once every {$cooldownHours} hours. Please wait {$hoursRemaining} more hours before changing plans again.");
        }
    }

    /**
     * @return array{0: Product, 1: Product}
     */
    private function lockProducts(Server $server, int $targetProductId): array
    {
        $productIds = array_values(array_unique([(int) $server->billing_product_id, $targetProductId]));
        sort($productIds);
        $products = Product::query()
            ->whereIn('id', $productIds)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        /** @var Product|null $current */
        $current = $products->get((int) $server->billing_product_id);
        /** @var Product|null $target */
        $target = $products->get($targetProductId);
        if (!$current || !$target) {
            throw new DisplayException('A billing product required for this plan change no longer exists.');
        }

        return [$current, $target];
    }

    private function currentProduct(Server $server): Product
    {
        if (!$server->billing_product_id) {
            throw new DisplayException('This server is not associated with a billing product.');
        }

        /** @var Product|null $product */
        $product = Product::query()->find($server->billing_product_id);
        if (!$product) {
            throw new DisplayException('The server billing product no longer exists.');
        }

        return $product;
    }

    private function assertNoConflictingOrders(Server $server, ?int $exceptOrderId = null): void
    {
        $query = Order::query()
            ->where('server_id', $server->id)
            ->whereIn('type', [Order::TYPE_REN, Order::TYPE_UPG])
            ->whereIn('status', [
                Order::STATUS_PENDING,
                Order::STATUS_FULFILLING,
                Order::STATUS_PAYMENT_REVIEW,
            ]);
        if ($exceptOrderId !== null) {
            $query->whereKeyNot($exceptOrderId);
        }

        if ($query->orderBy('id')->lockForUpdate()->exists()) {
            throw new DisplayException('Another renewal or plan-change checkout is already pending for this server.');
        }
    }

    private function assertScheduledSnapshot(Server $server, Product $currentProduct, Product $targetProduct): void
    {
        $snapshot = $server->scheduled_plan_change_snapshot;
        if (!is_array($snapshot)) {
            throw new DisplayException('The scheduled plan-change confirmation snapshot is missing.');
        }

        $currentMinor = $this->cyclePriceMinor($currentProduct, (int) $server->billing_days, (int) $server->node_id);
        $targetMinor = $this->cyclePriceMinor($targetProduct, (int) $server->billing_days, (int) $server->node_id);
        $expected = [
            'source_product_id' => (int) $currentProduct->id,
            'target_product_id' => (int) $targetProduct->id,
            'billing_days' => (int) $server->billing_days,
            'renewal_date' => $server->renewal_date?->toIso8601String(),
            'renewal_date_raw' => (string) $server->getRawOriginal('renewal_date'),
            'source_state_hash' => $this->productStateHash($currentProduct, $server, $currentMinor),
            'target_state_hash' => $this->productStateHash($targetProduct, $server, $targetMinor),
        ];
        foreach ($expected as $key => $value) {
            if (!array_key_exists($key, $snapshot) || (string) $snapshot[$key] !== (string) $value) {
                throw new DisplayException('The scheduled plan changed after confirmation. Cancel it and review a new quote before applying it.');
            }
        }
    }

    private function applyProductLocked(Server $server, Product $targetProduct, array $extraAttributes): Server
    {
        $this->entitlementService->synchronizeLocked($server, $server->owner_id, $targetProduct->id);

        $server->forceFill(array_merge([
            'billing_product_id' => $targetProduct->id,
            'last_plan_change_at' => now(),
        ], $extraAttributes))->saveOrFail();

        $buildData = [
            'memory' => $targetProduct->memory_limit,
            'disk' => $targetProduct->disk_limit,
            'cpu' => $targetProduct->cpu_limit,
            'backup_limit' => $targetProduct->backup_limit,
            'database_limit' => $targetProduct->database_limit,
            'allocation_limit' => $targetProduct->allocation_limit,
            'subdomain_limit' => $targetProduct->subdomain_limit,
        ];

        return $this->buildModificationService->handle($server, $buildData);
    }

    /**
     * Only contact Wings when a configured limit is actually being reduced.
     *
     * @return array<string, array{current: int|float, limit: int|float, unit: string}>
     */
    private function resourceViolations(Server $server, Product $newProduct): array
    {
        if (!$this->isResourceDowngrade($server, $newProduct)) {
            return [];
        }

        $violations = [];
        try {
            $stats = $this->daemonRepository->setServer($server)->getDetails();
            $currentUsage = $stats['utilization'] ?? [];
        } catch (\Throwable $exception) {
            Log::warning('Failed to fetch server utilization for plan downgrade validation', [
                'server_id' => $server->id,
                'error' => $exception->getMessage(),
            ]);
            throw new DisplayException('Unable to validate resource usage: the game server is currently unreachable. Please try again in a moment or contact support if the issue persists.');
        }

        if (isset($currentUsage['disk_bytes'])) {
            $current = (int) round($currentUsage['disk_bytes'] / 1024 / 1024);
            if ($current > $newProduct->disk_limit) {
                $violations['disk'] = ['current' => $current, 'limit' => $newProduct->disk_limit, 'unit' => 'MB'];
            }
        }
        if (isset($currentUsage['memory_bytes'])) {
            $current = (int) round($currentUsage['memory_bytes'] / 1024 / 1024);
            if ($current > $newProduct->memory_limit) {
                $violations['memory'] = ['current' => $current, 'limit' => $newProduct->memory_limit, 'unit' => 'MB'];
            }
        }
        if (isset($currentUsage['cpu_absolute']) && $newProduct->cpu_limit > 0) {
            $current = (int) round($currentUsage['cpu_absolute']);
            if ($current > $newProduct->cpu_limit) {
                $violations['cpu'] = ['current' => $current, 'limit' => $newProduct->cpu_limit, 'unit' => '%'];
            }
        }

        $counts = [
            'databases' => [$server->databases()->count(), $newProduct->database_limit, 'databases'],
            'backups' => [$server->backups()->count(), $newProduct->backup_limit, 'backups'],
            'allocations' => [$server->allocations()->count(), $newProduct->allocation_limit, 'allocations'],
        ];
        foreach ($counts as $resource => [$current, $limit, $unit]) {
            if ($current > $limit) {
                $violations[$resource] = ['current' => $current, 'limit' => $limit, 'unit' => $unit];
            }
        }

        $currentSubdomains = $server->customDomains()->count();
        if ($newProduct->subdomain_limit !== null && $currentSubdomains > $newProduct->subdomain_limit) {
            $violations['subdomains'] = [
                'current' => $currentSubdomains,
                'limit' => $newProduct->subdomain_limit,
                'unit' => 'subdomains',
            ];
        }

        return $violations;
    }

    private function isResourceDowngrade(Server $server, Product $newProduct): bool
    {
        return $newProduct->memory_limit < $server->memory
            || $newProduct->disk_limit < $server->disk
            || $newProduct->cpu_limit < $server->cpu
            || $newProduct->database_limit < $server->database_limit
            || $newProduct->backup_limit < $server->backup_limit
            || $newProduct->allocation_limit < $server->allocation_limit
            || (
                $newProduct->subdomain_limit !== null
                && ($server->subdomain_limit === null || $newProduct->subdomain_limit < $server->subdomain_limit)
            );
    }

    /**
     * Return true only for a complete, non-reversed capture record. A partial
     * local capture record is ambiguous and must remain reserved for review.
     */
    private function capturedPaymentState(?PaymentTransaction $transaction): bool
    {
        if ($transaction === null) {
            throw new DisplayException('The paid plan-change transaction is missing.');
        }

        $hasCaptureId = trim((string) $transaction->capture_id) !== '';
        $hasCapturedAt = $transaction->captured_at !== null;
        if ($hasCaptureId !== $hasCapturedAt) {
            throw new DisplayException('This plan-change payment has an ambiguous capture state and requires reconciliation.');
        }
        if ($transaction->provider_negative_status !== null) {
            throw new DisplayException('This plan-change payment has a reversal or dispute and requires reconciliation.');
        }

        return $hasCaptureId && $hasCapturedAt;
    }

    /**
     * Validate the immutable paid authorization without recalculating a
     * time-sensitive quote. This is used only after capture (including crash
     * recovery) so ordinary catalog price/time drift cannot strand paid funds.
     */
    private function capturedSnapshotProduct(
        Order $order,
        Server $server,
        Product $liveTarget,
        ?PaymentTransaction $transaction,
    ): Product {
        if (!$this->capturedPaymentState($transaction)) {
            throw new DisplayException('The plan-change payment has not been captured.');
        }

        $snapshot = $order->plan_change_snapshot;
        if (!is_array($snapshot)) {
            throw new DisplayException('The paid plan-change snapshot is missing.');
        }
        $this->assertSnapshotSelfConsistent($order, $snapshot);
        if (
            $transaction === null
            || number_format((float) $transaction->amount, 2, '.', '')
                !== number_format($this->minorToMajor((int) $order->checkout_amount_minor), 2, '.', '')
            || strtoupper((string) $transaction->currency)
                !== strtoupper((string) $order->checkout_currency)
        ) {
            throw new DisplayException('The captured plan-change amount does not match its locked order.');
        }

        if (
            (int) $snapshot['server_id'] !== (int) $server->id
            || (int) $snapshot['source_product_id'] !== (int) $server->billing_product_id
            || (int) $snapshot['target_product_id'] !== (int) $liveTarget->id
            || (int) $snapshot['billing_days'] !== (int) $server->billing_days
            || (int) $snapshot['node_id'] !== (int) $server->node_id
            || (string) ($snapshot['renewal_date_raw'] ?? '') !== (string) $server->getRawOriginal('renewal_date')
        ) {
            throw new DisplayException('The server entitlement changed after payment and requires reconciliation.');
        }

        /** @var array<string, mixed> $targetState */
        $targetState = $snapshot['target_state'];
        $snapshotWasFree = (float) ($targetState['price'] ?? 0) === 0.0;
        if ($snapshotWasFree !== $liveTarget->isFree()) {
            throw new DisplayException('The target plan changed between paid and free after capture and requires reconciliation.');
        }

        $snapshotProduct = new Product();
        $snapshotProduct->forceFill([
            'id' => (int) $snapshot['target_product_id'],
            'category_uuid' => (string) $targetState['category_uuid'],
            'price' => (float) $targetState['price'],
            'memory_limit' => (int) $targetState['memory_limit'],
            'disk_limit' => (int) $targetState['disk_limit'],
            'cpu_limit' => (int) $targetState['cpu_limit'],
            'backup_limit' => (int) $targetState['backup_limit'],
            'database_limit' => (int) $targetState['database_limit'],
            'allocation_limit' => (int) $targetState['allocation_limit'],
            'subdomain_limit' => $targetState['subdomain_limit'] === null
                ? null
                : (int) $targetState['subdomain_limit'],
        ]);
        $snapshotProduct->exists = true;

        $violations = $this->resourceViolations($server, $snapshotProduct);
        if (!empty($violations)) {
            throw new DisplayException($this->violationMessage($violations));
        }

        return $snapshotProduct;
    }

    /**
     * Verify all immutable quote inputs and ensure time passage has not turned
     * the stored price into an undercharge.
     *
     * @param array<string, mixed> $snapshot
     * @param array<string, mixed> $currentQuote
     */
    private function assertPaidSnapshot(Order $order, array $snapshot, array $currentQuote): void
    {
        $this->assertSnapshotSelfConsistent($order, $snapshot);

        foreach ([
            'currency',
            'current_cycle_minor',
            'target_cycle_minor',
            'billing_days',
            'node_id',
            'server_id',
            'source_product_id',
            'target_product_id',
            'source_state_hash',
            'target_state_hash',
            'renewal_date',
            'renewal_date_raw',
        ] as $key) {
            if (!array_key_exists($key, $snapshot) || (string) $snapshot[$key] !== (string) $currentQuote[$key]) {
                throw new DisplayException('The plan-change quote is stale. Refresh and try again.');
            }
        }

        if ((int) $snapshot['charge_minor'] < (int) $currentQuote['charge_minor']) {
            throw new DisplayException('The paid plan-change amount does not match the current quote.');
        }
    }

    /**
     * Verify that an HMAC-locked order snapshot is internally coherent. The
     * CheckoutIntegrityService authenticates the JSON; these checks prevent a
     * malformed but authenticated snapshot from driving unsafe fulfillment.
     *
     * @param array<string, mixed> $snapshot
     */
    private function assertSnapshotSelfConsistent(Order $order, array $snapshot): void
    {
        foreach (['source_state', 'target_state'] as $key) {
            if (!isset($snapshot[$key]) || !is_array($snapshot[$key])) {
                throw new DisplayException('The paid plan-change entitlement snapshot is incomplete.');
            }
        }

        /** @var array<string, mixed> $sourceState */
        $sourceState = $snapshot['source_state'];
        /** @var array<string, mixed> $targetState */
        $targetState = $snapshot['target_state'];
        foreach ([
            'id',
            'category_uuid',
            'price',
            'memory_limit',
            'disk_limit',
            'cpu_limit',
            'backup_limit',
            'database_limit',
            'allocation_limit',
            'subdomain_limit',
            'billing_days',
            'node_id',
            'cycle_minor',
        ] as $stateKey) {
            if (!array_key_exists($stateKey, $sourceState) || !array_key_exists($stateKey, $targetState)) {
                throw new DisplayException('The paid plan-change entitlement snapshot is incomplete.');
            }
        }

        $snapshotCharge = filter_var($snapshot['charge_minor'] ?? null, FILTER_VALIDATE_INT);
        $snapshotRemaining = filter_var($snapshot['remaining_seconds'] ?? null, FILTER_VALIDATE_INT);
        $billingDays = filter_var($snapshot['billing_days'] ?? null, FILTER_VALIDATE_INT);
        if (
            $snapshotCharge === false
            || $snapshotRemaining === false
            || $billingDays === false
            || $snapshotCharge <= 0
            || $snapshotRemaining < 0
            || $billingDays < 1
        ) {
            throw new DisplayException('The plan-change quote is invalid.');
        }

        $cycleSeconds = $billingDays * self::SECONDS_PER_DAY;
        $difference = (int) ($snapshot['target_cycle_minor'] ?? 0)
            - (int) ($snapshot['current_cycle_minor'] ?? 0);
        $expectedCharge = $difference > 0
            ? intdiv(($difference * $snapshotRemaining) + intdiv($cycleSeconds, 2), $cycleSeconds)
            : 0;

        if (
            !hash_equals((string) ($snapshot['source_state_hash'] ?? ''), $this->stateHash($sourceState))
            || !hash_equals((string) ($snapshot['target_state_hash'] ?? ''), $this->stateHash($targetState))
            || (int) $sourceState['id'] !== (int) ($snapshot['source_product_id'] ?? 0)
            || (int) $targetState['id'] !== (int) ($snapshot['target_product_id'] ?? 0)
            || (int) $sourceState['billing_days'] !== $billingDays
            || (int) $targetState['billing_days'] !== $billingDays
            || (int) $sourceState['node_id'] !== (int) ($snapshot['node_id'] ?? 0)
            || (int) $targetState['node_id'] !== (int) ($snapshot['node_id'] ?? 0)
            || (int) $sourceState['cycle_minor'] !== (int) ($snapshot['current_cycle_minor'] ?? -1)
            || (int) $targetState['cycle_minor'] !== (int) ($snapshot['target_cycle_minor'] ?? -1)
            || $snapshotCharge !== $expectedCharge
            || (int) $order->server_id !== (int) ($snapshot['server_id'] ?? 0)
            || (int) $order->source_product_id !== (int) ($snapshot['source_product_id'] ?? 0)
            || (int) $order->product_id !== (int) ($snapshot['target_product_id'] ?? 0)
            || (int) $order->checkout_amount_minor !== $snapshotCharge
            || strtoupper((string) $order->checkout_currency) !== strtoupper((string) ($snapshot['currency'] ?? ''))
        ) {
            throw new DisplayException('The paid plan-change snapshot does not match its locked order.');
        }
    }

    private function cyclePriceMinor(Product $product, int $billingDays, int $nodeId): int
    {
        $price = $this->cycles()->calculatePrice($product, $billingDays, $nodeId)['price'];

        return (int) round(((float) $price) * 100);
    }

    private function minorToMajor(int $minor): float
    {
        return $minor / 100;
    }

    private function currency(): string
    {
        $currency = strtoupper((string) config('modules.billing.currency.code'));
        if (!preg_match('/^[A-Z]{3}$/', $currency) || in_array($currency, self::UNSUPPORTED_CURRENCIES, true)) {
            throw new DisplayException('This billing installation requires a supported two-decimal currency for plan changes.');
        }

        return $currency;
    }

    private function cycles(): BillingCycleService
    {
        return $this->billingCycleService ?? app(BillingCycleService::class);
    }

    /**
     * @return array<string, mixed>
     */
    private function productState(Product $product, Server $server, ?int $cycleMinor = null): array
    {
        return [
            'id' => (int) $product->id,
            'category_uuid' => (string) $product->category_uuid,
            'visible' => array_key_exists('visible', $product->getAttributes()) ? (bool) $product->visible : null,
            'price' => number_format((float) $product->price, 2, '.', ''),
            'memory_limit' => (int) $product->memory_limit,
            'disk_limit' => (int) $product->disk_limit,
            'cpu_limit' => (int) $product->cpu_limit,
            'backup_limit' => (int) $product->backup_limit,
            'database_limit' => (int) $product->database_limit,
            'allocation_limit' => (int) $product->allocation_limit,
            'subdomain_limit' => $product->subdomain_limit === null ? null : (int) $product->subdomain_limit,
            'billing_days' => (int) $server->billing_days,
            'node_id' => (int) $server->node_id,
            'cycle_minor' => $cycleMinor ?? $this->cyclePriceMinor(
                $product,
                (int) $server->billing_days,
                (int) $server->node_id
            ),
        ];
    }

    private function productStateHash(Product $product, Server $server, ?int $cycleMinor = null): string
    {
        return $this->stateHash($this->productState($product, $server, $cycleMinor));
    }

    /**
     * @param array<string, mixed> $state
     */
    private function stateHash(array $state): string
    {
        return hash('sha256', json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    }

    /**
     * @param array<string, array{current: int|float, limit: int|float, unit: string}> $violations
     */
    private function violationMessage(array $violations): string
    {
        $messages = [];
        foreach ($violations as $resource => $data) {
            $messages[] = ucfirst($resource) . ': using ' . $data['current'] . ' ' . $data['unit']
                . ', new limit is ' . $data['limit'] . ' ' . $data['unit'];
        }

        return 'Cannot apply this plan: current usage exceeds the selected plan limits. ' . implode('; ', $messages);
    }
}
