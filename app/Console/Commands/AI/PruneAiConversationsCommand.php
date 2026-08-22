<?php

namespace Everest\Console\Commands\AI;

use Everest\Models\AiToolCall;
use Everest\Models\AiUsageLog;
use Illuminate\Console\Command;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Everest\Models\AiToolDiscovery;
use Illuminate\Database\Eloquent\Builder;
use Everest\Services\AI\Agent\AgentEventLog;

class PruneAiConversationsCommand extends Command
{
    protected $signature = 'p:ai:prune-conversations';

    protected $description = 'Delete expired AI conversations and prune retained agent data.';

    public function handle(AgentEventLog $events): int
    {
        $deleted = AiConversation::where('is_saved', false)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->delete();

        $this->info("Pruned {$deleted} expired AI conversation(s).");

        $this->report('agent turn event', $events->prune(
            $this->days('turn_events'),
            $this->limit('turn_events'),
        ));

        $this->report('tool discovery event', $this->pruneByCreatedAt(
            AiToolDiscovery::query(),
            $this->days('tool_discovery'),
            $this->limit('tool_discovery'),
        ));

        $this->report('tool-call audit record', $this->pruneByCreatedAt(
            AiToolCall::query(),
            $this->days('tool_calls'),
            $this->limit('tool_calls'),
        ));

        $this->report('usage log', $this->pruneByCreatedAt(
            AiUsageLog::query(),
            $this->days('usage_logs'),
            $this->limit('usage_logs'),
        ));

        $pending = AiPendingAction::query()
            ->whereNotIn('status', [
                AiPendingAction::STATUS_PENDING,
                AiPendingAction::STATUS_EXECUTING,
            ])
            ->where('updated_at', '<', now()->subDays($this->days('pending_actions')));

        $this->report(
            'terminal pending action',
            $this->deleteBatch($pending, $this->limit('pending_actions'), 'updated_at'),
        );

        return Command::SUCCESS;
    }

    private function pruneByCreatedAt(Builder $query, int $days, int $limit): int
    {
        return $this->deleteBatch(
            $query->where('created_at', '<', now()->subDays($days)),
            $limit,
            'created_at',
        );
    }

    /**
     * Select a bounded set of primary keys before deleting it. This produces
     * the same SQL shape on MySQL and SQLite and never lets one cleanup pass
     * turn a backlog into an unbounded write lock.
     */
    private function deleteBatch(Builder $query, int $limit, string $oldestColumn): int
    {
        $ids = (clone $query)
            ->orderBy($oldestColumn)
            ->orderBy('id')
            ->limit(max(1, $limit))
            ->pluck('id')
            ->all();

        if ($ids === []) {
            return 0;
        }

        return $query->getModel()->newQuery()->whereKey($ids)->delete();
    }

    private function days(string $key): int
    {
        return max(1, (int) config("modules.ai.retention.{$key}_days"));
    }

    private function limit(string $key): int
    {
        return max(1, (int) config("modules.ai.retention.{$key}_limit"));
    }

    private function report(string $label, int $deleted): void
    {
        $this->info("Pruned {$deleted} expired {$label}(s).");
    }
}
