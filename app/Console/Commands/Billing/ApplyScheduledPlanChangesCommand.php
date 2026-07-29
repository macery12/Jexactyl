<?php

namespace Everest\Console\Commands\Billing;

use Everest\Models\Server;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Everest\Exceptions\DisplayException;
use Everest\Services\Billing\PlanChangeService;

class ApplyScheduledPlanChangesCommand extends Command
{
    protected $signature = 'p:billing:apply-scheduled-plan-changes';

    protected $description = 'Apply plan changes that reached their scheduled renewal date.';

    public function __construct(private PlanChangeService $planChangeService)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        Server::query()
            ->whereNotNull('scheduled_billing_product_id')
            ->whereNotNull('scheduled_plan_change_at')
            ->where('scheduled_plan_change_at', '<=', now())
            ->where(function ($query): void {
                $query->whereNull('scheduled_plan_change_retry_at')
                    ->orWhere('scheduled_plan_change_retry_at', '<=', now());
            })
            ->orderBy('id')
            ->chunkById(100, function ($servers): void {
                foreach ($servers as $server) {
                    try {
                        $updated = $this->planChangeService->applyDueScheduledChange($server->id);
                        if ($updated !== null) {
                            $this->info("Applied scheduled plan change for server {$server->id}.");
                        }
                    } catch (\Throwable $exception) {
                        $safeReason = $exception instanceof DisplayException
                            ? mb_substr($exception->getMessage(), 0, 2000)
                            : 'An unexpected error prevented this scheduled plan change. An administrator must review the application logs.';
                        Server::query()
                            ->whereKey($server->id)
                            ->where('scheduled_billing_product_id', $server->scheduled_billing_product_id)
                            ->where('scheduled_plan_change_at', $server->scheduled_plan_change_at)
                            ->where(
                                'scheduled_plan_change_snapshot',
                                $server->getRawOriginal('scheduled_plan_change_snapshot')
                            )
                            ->update([
                                'scheduled_plan_change_retry_at' => now()->addMinutes(15),
                                'scheduled_plan_change_last_error' => $safeReason,
                            ]);
                        Log::warning('Scheduled plan change could not be applied and remains pending.', [
                            'server_id' => $server->id,
                            'target_product_id' => $server->scheduled_billing_product_id,
                            'effective_at' => $server->scheduled_plan_change_at?->toIso8601String(),
                            'reason' => $safeReason,
                        ]);
                        if (!$exception instanceof DisplayException) {
                            report($exception);
                        }
                        $this->error("Server {$server->id}: {$safeReason}");
                    }
                }
            });

        return self::SUCCESS;
    }
}
