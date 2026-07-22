<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Illuminate\Support\Facades\Cache;
use Everest\Models\Billing\BillingException;
use Everest\Services\Billing\BillingCycleService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Billing\DeleteStripeKeysRequest;
use Everest\Http\Requests\Api\Application\Billing\GetBillingAnalyticsRequest;
use Everest\Http\Requests\Api\Application\Billing\UpdateBillingSettingsRequest;

class BillingController extends ApplicationApiController
{
    /**
     * BillingController constructor.
     */
    public function __construct(private BillingCycleService $billingCycleService)
    {
        parent::__construct();
    }

    /**
     * Update the billing settings for the Panel.
     *
     * @throws \Throwable
     */
    public function settings(UpdateBillingSettingsRequest $request): Response
    {
        // todo(jex): use normalized request with foreach key value pairs
        $key = $request->input('key');
        $value = $request->input('value');

        if ($key === 'renewal:default_billing_days') {
            $oldDefault = (int) Setting::get('settings::modules:billing:renewal:default_billing_days', 30);
            $newDefault = (int) $value;

            Setting::set('settings::modules:billing:' . $key, $value);

            if ($oldDefault !== $newDefault) {
                $this->billingCycleService->reseedDefaultBillingCycle($oldDefault, $newDefault);
            }
        } else {
            Setting::set('settings::modules:billing:' . $key, $value);
        }

        if (strpos($key, 'keys:') !== 0) {
            Activity::event('admin:billing:update')
                ->property('settings', $request->all())
                ->description('M12Labs billing settings were updated')
                ->log();
        }

        return $this->returnNoContent();
    }

    /**
     * Gather and return billing analytics.
     */
    public function analytics(GetBillingAnalyticsRequest $request): array
    {
        // Cache the assembled dashboard briefly. The endpoint takes no parameters, so a
        // single key is correct; a short TTL absorbs repeated polling while keeping the
        // figures effectively live. Staleness is bounded to the TTL.
        return Cache::remember('billing.analytics.dashboard', 60, fn () => $this->buildAnalytics());
    }

    /**
     * Assemble the billing analytics payload. Extracted so {@see analytics()} can cache it.
     */
    private function buildAnalytics(): array
    {
        // Load a lightweight order list for the last year (only the fields the
        // dashboard charts require). Capped at 10 000 rows so very large installs
        // never pull unbounded data into memory.
        $orders = Order::where('created_at', '>=', Carbon::now()->subYear())
            ->select('id', 'status', 'created_at', 'total', 'payment_processor')
            ->orderBy('created_at', 'desc')
            ->limit(10000)
            ->get();

        // Calculate upcoming renewals
        $now = Carbon::now();

        // Aggregate counts + expected revenue at the database level (joining products for
        // price) instead of hydrating every renewable server into memory.
        $overdue = $this->renewalAggregate(fn ($q) => $q->where('renewal_date', '<', $now));
        $in7Days = $this->renewalAggregate(fn ($q) => $q->whereBetween('renewal_date', [$now, $now->copy()->addDays(7)]));
        $in8to14Days = $this->renewalAggregate(fn ($q) => $q->whereBetween('renewal_date', [$now->copy()->addDays(7), $now->copy()->addDays(14)]));

        // Total for all renewals in next 14 days (including overdue)
        $totalRenewalsIn14Days = $overdue['count'] + $in7Days['count'] + $in8to14Days['count'];
        $totalExpectedRevenue14Days = $overdue['expectedRevenue'] + $in7Days['expectedRevenue'] + $in8to14Days['expectedRevenue'];

        // Calculate forecast based on ALL active billing servers (including past-due): a
        // server with a billing subscription is still generating revenue even if past due.
        // Use the actual billed amount (billing_amount), not the catalog base price, so
        // coupon discounts and cycle multipliers are reflected. Summed in the database.
        $totalDailyRevenue = (float) Server::whereNotNull('billing_product_id')
            ->where('billing_days', '>', 0)
            ->where('billing_amount', '>', 0)
            ->selectRaw('COALESCE(SUM(billing_amount / billing_days), 0) as daily')
            ->value('daily');

        $forecast7Days = $totalDailyRevenue * 7;
        $forecast30Days = $totalDailyRevenue * 30;

        // Subscription base: servers currently attached to a paid plan. This is the
        // population the MRR/forecast figures are derived from.
        $activeSubscriptions = Server::whereNotNull('billing_product_id')
            ->where('billing_days', '>', 0)
            ->where('billing_amount', '>', 0)
            ->count();

        // What's actually selling: per-product subscription count and MRR contribution
        // (actual billed amounts, so coupons/cycle multipliers are reflected).
        $topProducts = Server::query()
            ->whereNotNull('billing_product_id')
            ->where('billing_days', '>', 0)
            ->where('billing_amount', '>', 0)
            ->join('products', 'servers.billing_product_id', '=', 'products.id')
            ->groupBy('servers.billing_product_id', 'products.name')
            ->selectRaw('servers.billing_product_id as id, products.name as name')
            ->selectRaw('COUNT(*) as subscriptions')
            ->selectRaw('ROUND(COALESCE(SUM(servers.billing_amount / servers.billing_days), 0) * 30, 2) as mrr')
            ->orderByDesc('mrr')
            ->limit(5)
            ->toBase() // plain rows — hydrating Server models would serialize appended accessors
            ->get();

        // Get suspended servers with details (capped at 200 to protect memory)
        $suspendedServers = Server::where('status', Server::STATUS_SUSPENDED)
            ->with('user')
            ->orderBy('updated_at', 'desc')
            ->limit(200)
            ->get()
            ->map(function ($server) {
                return [
                    'id' => $server->id,
                    'uuid' => $server->uuid,
                    'name' => $server->name,
                    'owner' => $server->user ? $server->user->username : 'Unknown',
                    'owner_email' => $server->user ? $server->user->email : null,
                ];
            });

        // Get recent billing events (last 5 orders)
        $recentEvents = Order::with('server')
            ->orderBy('created_at', 'desc')
            ->limit(5)
            ->get()
            ->map(function ($order) {
                return [
                    'id' => $order->id,
                    'date' => $order->created_at,
                    'type' => $order->type,
                    'status' => $order->status,
                    'payment_processor' => $order->payment_processor,
                    'total' => $order->total,
                    'server_id' => $order->server_id,
                    'server_uuid' => $order->server?->uuid,
                    'server_name' => $order->server?->name,
                ];
            });

        return [
            'orders'     => $orders,
            'categories' => Category::all(),
            'products' => Product::all(),
            'upcomingRenewals' => [
                'overdue' => $overdue,
                'in7Days' => $in7Days,
                'in8to14Days' => $in8to14Days,
                'total14Days' => [
                    'count' => $totalRenewalsIn14Days,
                    'expectedRevenue' => $totalExpectedRevenue14Days,
                ],
            ],
            'forecast' => [
                'next7Days' => round($forecast7Days, 2),
                'next30Days' => round($forecast30Days, 2),
            ],
            'activeSubscriptions' => $activeSubscriptions,
            'topProducts' => $topProducts,
            'exceptions7d' => BillingException::where('created_at', '>=', $now->copy()->subDays(7))->count(),
            'suspendedServers' => $suspendedServers,
            'recentEvents' => $recentEvents,
        ];
    }

    /**
     * Aggregate the renewable-server count and expected revenue for a date window,
     * computed entirely in the database (no model hydration). The $constrain closure
     * applies the renewal_date filter that distinguishes each window.
     *
     * @return array{count: int, expectedRevenue: float}
     */
    private function renewalAggregate(callable $constrain): array
    {
        $query = Server::query()
            ->whereNotNull('renewal_date')
            ->whereNotNull('billing_product_id')
            ->leftJoin('products', 'servers.billing_product_id', '=', 'products.id');

        $constrain($query);

        $row = $query
            ->selectRaw('COUNT(*) as cnt, COALESCE(SUM(products.price), 0) as revenue')
            ->first();

        return [
            'count' => (int) ($row->cnt ?? 0),
            'expectedRevenue' => (float) ($row->revenue ?? 0),
        ];
    }

    /**
     * Delete all Stripe API keys saved to the Panel.
     */
    public function resetKeys(DeleteStripeKeysRequest $request): Response
    {
        Setting::forget('settings::modules:billing:keys:publishable');
        Setting::forget('settings::modules:billing:keys:secret');

        Activity::event('admin:billing:reset-keys')
            ->description('Stripe API keys for billing were reset')
            ->log();

        return $this->returnNoContent();
    }
}
