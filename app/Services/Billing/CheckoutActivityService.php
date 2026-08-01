<?php

namespace Everest\Services\Billing;

use Everest\Models\Node;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Facades\Activity;
use Everest\Models\ActivityLog;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Coupon;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Log;

/**
 * Writes the admin-visible activity entry for a checkout that has actually
 * committed node resources: a newly provisioned server, a renewal that keeps
 * one running, or a plan change that resizes one.
 *
 * Checkouts that never reach fulfillment — failed, cancelled, expired, or still
 * pending payment — are deliberately not recorded here. Those remain visible on
 * the orders page, which keeps this feed to events an operator can correlate
 * against real node capacity.
 */
class CheckoutActivityService
{
    private const FREE = 'free';

    /**
     * Record a fulfilled checkout. Never throws: a bookkeeping entry must not
     * be able to unwind an order whose payment has already been captured and
     * whose server already exists.
     */
    public function recordFulfilled(Order $order, Server $server): void
    {
        try {
            $event = match ($order->type) {
                Order::TYPE_REN => ActivityLog::EVENT_CHECKOUT_RENEWED,
                Order::TYPE_UPG => ActivityLog::EVENT_CHECKOUT_UPGRADED,
                default => ActivityLog::EVENT_CHECKOUT_COMPLETED,
            };

            $logger = Activity::event($event)
                ->description($this->describe($order, $server, $event))
                ->property($this->properties($order, $server))
                ->subject($server);

            // Webhook and queued fulfillment run without an authenticated user,
            // so attribute the entry to the buyer explicitly rather than
            // letting it fall back to "system".
            if ($buyer = User::find($order->user_id)) {
                $logger->actor($buyer);
            }

            $logger->log();
        } catch (\Throwable $exception) {
            Log::warning('Failed to record checkout activity', [
                'order_id' => $order->id,
                'server_id' => $server->id,
                'error' => $exception->getMessage(),
            ]);
        }
    }

    /**
     * The one-line summary the admin activity feed renders directly.
     */
    private function describe(Order $order, Server $server, string $event): string
    {
        $node = $this->nodeName($server) ?? "node #{$server->node_id}";
        $product = $this->productName($order) ?? "product #{$order->product_id}";
        $verb = match ($event) {
            ActivityLog::EVENT_CHECKOUT_RENEWED => 'Renewed',
            ActivityLog::EVENT_CHECKOUT_UPGRADED => 'Changed plan for',
            default => 'Provisioned',
        };

        $amount = $this->formatAmount($order);
        $payment = $amount === self::FREE
            ? 'no charge'
            : $amount . ' via ' . $this->processorLabel($order);

        return sprintf('%s "%s" on %s — %s, %s', $verb, $server->name, $node, $product, $payment);
    }

    /**
     * @return array<string, mixed>
     */
    private function properties(Order $order, Server $server): array
    {
        $properties = [
            'order_id' => $order->id,
            'order_type' => $order->type,
            'processor' => $order->payment_processor,
            'amount' => $this->formatAmount($order),
            'product' => $this->productName($order),
            'product_id' => $order->product_id,
            'server_name' => $server->name,
            'server_uuid' => $server->uuid,
            'node' => $this->nodeName($server),
            'node_id' => $server->node_id,
            'billing_days' => $order->billing_days,
            // The resources this checkout put on the node, so an operator can
            // read capacity impact without opening the server. Kept flat because
            // the transformer collapses array properties into a bare count.
            'memory_mib' => $server->memory,
            'disk_mib' => $server->disk,
            'cpu_percent' => $server->cpu,
        ];

        if ($order->coupon_id && $coupon = Coupon::find($order->coupon_id)) {
            $properties['coupon'] = $coupon->code;
        }

        return array_filter($properties, fn ($value) => !is_null($value));
    }

    /**
     * Read the names off the base tables rather than the relations so a node or
     * product deleted after fulfillment degrades to null instead of throwing
     * and costing us the entry entirely.
     */
    private function nodeName(Server $server): ?string
    {
        $name = Node::query()->whereKey($server->node_id)->value('name');

        return is_string($name) ? $name : null;
    }

    private function productName(Order $order): ?string
    {
        if ($order->product_name) {
            return $order->product_name;
        }

        $name = Product::query()->whereKey($order->product_id)->value('name');

        return is_string($name) ? $name : null;
    }

    private function formatAmount(Order $order): string
    {
        if ($order->payment_processor === self::FREE || (float) $order->total <= 0.0) {
            return self::FREE;
        }

        $currency = strtoupper((string) ($order->checkout_currency
            ?: config('modules.billing.currency.code', 'USD')));

        return number_format((float) $order->total, 2) . ' ' . $currency;
    }

    private function processorLabel(Order $order): string
    {
        return match ($order->payment_processor) {
            'paypal' => 'PayPal',
            'stripe' => 'Stripe',
            default => (string) ($order->payment_processor ?: 'unknown'),
        };
    }
}
