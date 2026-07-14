<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Node;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Ticket;
use Everest\Models\ActivityLog;
use Everest\Models\DeferredEmail;
use Everest\Models\Billing\BillingException;
use Illuminate\Http\JsonResponse;
use Everest\Services\Helpers\SoftwareVersionService;
use Everest\Http\Requests\Api\Application\OverviewRequest;

class OverviewController extends ApplicationApiController
{
    /**
     * OverviewController constructor.
     */
    public function __construct(
        private SoftwareVersionService $softwareVersionService
    ) {
        parent::__construct();
    }

    /**
     * Returns version information.
     *
     * Superseded by the aggregate {@see self::index()} (`health.version`) for the V2 UI,
     * but still consumed by the V1 admin frontend (OverviewContainer + ExtensionsContainer).
     * Do not remove until V1 is decommissioned.
     */
    public function version(OverviewRequest $request): JsonResponse
    {
        return new JsonResponse($this->softwareVersionService->getVersionData());
    }

    /**
     * Returns metrics relating to server count, user count & more.
     *
     * Superseded by the aggregate {@see self::index()} for the V2 UI, but still consumed
     * by the V1 admin overview (OverviewContainer). Do not remove until V1 is decommissioned.
     */
    public function metrics(OverviewRequest $request): JsonResponse
    {
        $nodes = Node::query()->count();
        $servers = Server::query()->count();
        $tickets = Ticket::query()->where('status', Ticket::STATUS_PENDING)->count();

        return new JsonResponse([
            'nodes' => $nodes,
            'servers' => $servers,
            'tickets' => $tickets,
        ]);
    }

    /**
     * Aggregate admin overview payload — one cheap, DB-only snapshot driving the
     * `/v2/admin` overview dashboard. Everything here is a count or a summed column
     * so the endpoint is safe to poll on an interval. Live per-node/per-server power
     * state is intentionally excluded (it requires hitting Wings and does not belong
     * in a polled aggregate).
     */
    public function index(OverviewRequest $request): JsonResponse
    {
        return new JsonResponse([
            'health' => $this->health(),
            'fleet' => $this->fleet(),
            'queues' => $this->queues(),
            'kpis' => $this->kpis(),
            'activity' => $this->activity(),
        ]);
    }

    /**
     * Panel version / update posture.
     */
    private function health(): array
    {
        return [
            'version' => [
                'current' => $this->softwareVersionService->getCurrentVersion(),
                'latest' => $this->softwareVersionService->getLatestPanel(),
                'isLatest' => $this->softwareVersionService->isLatestPanel(),
            ],
        ];
    }

    /**
     * Server + node counts and cluster capacity utilisation. Capacity is the sum of
     * allocated resources (`sum_memory` / `sum_disk`) over the configured totals.
     */
    private function fleet(): array
    {
        // Allocated resources are the sum of each server's reserved memory/disk; the
        // cluster ceiling is the sum of each node's configured memory/disk.
        $servers = Server::query()
            ->selectRaw('COUNT(*) as total')
            ->selectRaw('COALESCE(SUM(status = ?), 0) as suspended', [Server::STATUS_SUSPENDED])
            ->selectRaw('COALESCE(SUM(status IN (?, ?)), 0) as install_failed', [Server::STATUS_INSTALL_FAILED, Server::STATUS_REINSTALL_FAILED])
            ->selectRaw('COALESCE(SUM(memory), 0) as memory_used')
            ->selectRaw('COALESCE(SUM(disk), 0) as disk_used')
            ->first();

        $total = (int) $servers->total;
        $suspended = (int) $servers->suspended;
        $installFailed = (int) $servers->install_failed;
        $memoryUsed = (int) $servers->memory_used;
        $diskUsed = (int) $servers->disk_used;

        $nodes = Node::query()
            ->selectRaw('COUNT(*) as total')
            ->selectRaw('COALESCE(SUM(maintenance_mode = 1), 0) as maintenance')
            ->selectRaw('COALESCE(SUM(memory), 0) as memory_total')
            ->selectRaw('COALESCE(SUM(disk), 0) as disk_total')
            ->first();

        $memoryTotal = (int) $nodes->memory_total;
        $diskTotal = (int) $nodes->disk_total;

        return [
            'servers' => [
                'total' => $total,
                'active' => max(0, $total - $suspended),
                'suspended' => $suspended,
                'installFailed' => $installFailed,
            ],
            'nodes' => [
                'total' => (int) $nodes->total,
                'maintenance' => (int) $nodes->maintenance,
            ],
            'capacity' => [
                'memoryUsed' => $memoryUsed,
                'memoryTotal' => $memoryTotal,
                'memoryPercent' => $memoryTotal > 0 ? (int) round($memoryUsed / $memoryTotal * 100) : 0,
                'diskUsed' => $diskUsed,
                'diskTotal' => $diskTotal,
                'diskPercent' => $diskTotal > 0 ? (int) round($diskUsed / $diskTotal * 100) : 0,
            ],
        ];
    }

    /**
     * Work waiting on an admin: open tickets, recent billing exceptions, and the
     * deferred-email backlog.
     */
    private function queues(): array
    {
        $tickets = Ticket::query()
            ->selectRaw('COALESCE(SUM(status = ?), 0) as pending', [Ticket::STATUS_PENDING])
            ->selectRaw('COALESCE(SUM(status = ?), 0) as in_progress', [Ticket::STATUS_IN_PROGRESS])
            ->first();

        return [
            'tickets' => [
                'pending' => (int) $tickets->pending,
                'inProgress' => (int) $tickets->in_progress,
            ],
            'billingExceptions' => BillingException::query()
                ->where('created_at', '>=', now()->subDays(7))
                ->count(),
            'deferredEmails' => DeferredEmail::query()->whereNull('sent_at')->count(),
        ];
    }

    /**
     * Growth KPIs. Monthly recurring revenue mirrors the Billing analytics query
     * (daily billed amount × 30) so the number matches the Billing module.
     */
    private function kpis(): array
    {
        $dailyRevenue = (float) Server::query()
            ->whereNotNull('billing_product_id')
            ->where('billing_days', '>', 0)
            ->where('billing_amount', '>', 0)
            ->selectRaw('COALESCE(SUM(billing_amount / billing_days), 0) as daily')
            ->value('daily');

        return [
            'users' => [
                'total' => User::query()->count(),
                'newThisWeek' => User::query()->where('created_at', '>=', now()->subDays(7))->count(),
            ],
            'revenue' => [
                'monthlyRecurring' => round($dailyRevenue * 30, 2),
            ],
        ];
    }

    /**
     * The six most recent administrative activity-log entries, slimmed for the feed.
     */
    private function activity(): array
    {
        return ActivityLog::query()
            ->with('actor')
            ->where(function ($query) {
                $query->where('scope', 'admin')
                    ->orWhere(fn ($sub) => $sub->where('scope', 'server')->where('is_admin', true))
                    ->orWhere(fn ($sub) => $sub->whereNull('scope')->where('is_admin', true));
            })
            ->whereNotIn('event', ActivityLog::DISABLED_EVENTS)
            ->orderByDesc('timestamp')
            ->limit(6)
            ->get()
            ->map(fn (ActivityLog $log) => [
                'id' => sha1($log->id),
                'event' => $log->event,
                'description' => $log->description,
                'actor' => $log->actor?->username ?? 'system',
                'timestamp' => $log->timestamp->toIso8601String(),
            ])
            ->all();
    }
}
