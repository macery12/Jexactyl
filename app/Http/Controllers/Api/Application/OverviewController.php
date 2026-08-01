<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Node;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Ticket;
use Everest\Models\ActivityLog;
use Everest\Models\DeferredEmail;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\BillingException;
use Everest\Services\Helpers\SoftwareVersionService;
use Everest\Http\Requests\Api\Application\OverviewRequest;

class OverviewController extends ApplicationApiController
{
    /**
     * OverviewController constructor.
     */
    public function __construct(
        private SoftwareVersionService $softwareVersionService,
    ) {
        parent::__construct();
    }

    /**
     * Aggregate admin overview payload — one cheap, DB-only snapshot driving the
     * `/admin` overview dashboard. Everything here is a count or a summed column
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

        $total = (int) $servers->getAttribute('total');
        $suspended = (int) $servers->getAttribute('suspended');
        $installFailed = (int) $servers->getAttribute('install_failed');
        $memoryUsed = (int) $servers->getAttribute('memory_used');
        $diskUsed = (int) $servers->getAttribute('disk_used');

        // Per-node allocation, so the dashboard can show each node's posture
        // instead of a single cluster-wide number.
        $usageByNode = Server::query()
            ->selectRaw('node_id')
            ->selectRaw('COUNT(*) as servers')
            ->selectRaw('COALESCE(SUM(memory), 0) as memory_used')
            ->selectRaw('COALESCE(SUM(disk), 0) as disk_used')
            ->groupBy('node_id')
            ->get()
            ->keyBy('node_id');

        $nodeList = Node::query()
            ->orderBy('name')
            ->get(['id', 'name', 'maintenance_mode', 'memory', 'memory_overallocate', 'disk', 'disk_overallocate'])
            ->map(function (Node $node) use ($usageByNode) {
                $usage = $usageByNode->get($node->id);

                return [
                    'id' => $node->id,
                    'name' => $node->name,
                    'maintenance' => (bool) $node->maintenance_mode,
                    'servers' => (int) ($usage->servers ?? 0),
                    'memory' => $this->nodeResource((int) ($usage->memory_used ?? 0), $node->memory, $node->memory_overallocate),
                    'disk' => $this->nodeResource((int) ($usage->disk_used ?? 0), $node->disk, $node->disk_overallocate),
                ];
            })
            ->all();

        $memoryTotal = array_sum(array_column(array_column($nodeList, 'memory'), 'total'));
        $diskTotal = array_sum(array_column(array_column($nodeList, 'disk'), 'total'));
        $maintenance = count(array_filter($nodeList, fn (array $node) => $node['maintenance']));

        return [
            'servers' => [
                'total' => $total,
                'active' => max(0, $total - $suspended),
                'suspended' => $suspended,
                'installFailed' => $installFailed,
            ],
            'nodes' => [
                'total' => count($nodeList),
                'maintenance' => $maintenance,
                'list' => $nodeList,
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
     * Allocation posture for one node resource. `limitPercent` is the configured
     * overallocation ceiling expressed against physical capacity (150 = 50%
     * overallocation allowed); null means unlimited overallocation.
     */
    private function nodeResource(int $used, int $total, int $overallocate): array
    {
        return [
            'used' => $used,
            'total' => $total,
            'percent' => $total > 0 ? (int) round($used / $total * 100) : 0,
            'limitPercent' => $overallocate < 0 ? null : 100 + $overallocate,
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
                'pending' => (int) $tickets->getAttribute('pending'),
                'inProgress' => (int) $tickets->getAttribute('in_progress'),
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
            ->adminVisible()
            ->orderByDesc('timestamp')
            ->limit(6)
            ->get()
            ->map(fn (ActivityLog $log) => [
                'id' => sha1($log->id),
                'event' => $log->event,
                'description' => $log->description,
                'actor' => $log->actor instanceof User ? $log->actor->username : 'system',
                'timestamp' => $log->timestamp->toIso8601String(),
            ])
            ->all();
    }
}
