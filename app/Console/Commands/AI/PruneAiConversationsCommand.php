<?php

namespace Everest\Console\Commands\AI;

use Illuminate\Console\Command;
use Everest\Models\AiConversation;
use Everest\Services\AI\Agent\AgentEventLog;

class PruneAiConversationsCommand extends Command
{
    protected $signature = 'p:ai:prune-conversations';

    protected $description = 'Delete expired AI conversations and the turn events behind them.';

    /**
     * How long a turn's event log is kept.
     *
     * Short on purpose. The log exists so a client can rejoin a turn that is
     * still running; once the turn is over, the transcript is the record and
     * this is a duplicate of it at frame granularity. A busy turn writes
     * hundreds of rows, so keeping them past the point anything can read them
     * is the growth PERF-014 warns about, bought for nothing.
     */
    private const EVENT_RETENTION_DAYS = 2;

    public function handle(AgentEventLog $events): int
    {
        $deleted = AiConversation::where('is_saved', false)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now())
            ->delete();

        $this->info("Pruned {$deleted} expired AI conversation(s).");

        // Bounded per pass rather than "delete everything old": one busy day can
        // leave far more rows than a single statement should hold a lock for,
        // and the schedule comes back tomorrow.
        $frames = $events->prune(self::EVENT_RETENTION_DAYS);

        $this->info("Pruned {$frames} expired agent turn event(s).");

        return Command::SUCCESS;
    }
}
