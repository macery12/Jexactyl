<?php

namespace Everest\Services\AI\Support;

use Everest\Models\User;
use Everest\Models\Setting;
use Everest\Models\AiUsageLog;
use Illuminate\Support\Carbon;

/**
 * Monthly token budgets.
 *
 * Request-count rate limits alone give no meaningful cost ceiling once one
 * user message expands into a dozen model calls, so spend is measured in the
 * unit it is actually billed in. Checked before a turn starts rather than
 * mid-flight: stopping halfway through leaves a half-applied change, which is
 * worse than not starting.
 */
class AiBudgetService
{
    /**
     * Cache window for a user's running total. Short enough that a user cannot
     * meaningfully overshoot, long enough to keep an aggregate query off the
     * hot path of every turn.
     */
    public const CACHE_SECONDS = 60;

    public function enforced(): bool
    {
        return filter_var(
            Setting::get('settings::modules:ai:budget:enforce', config('modules.ai.budget.enforce', false)),
            FILTER_VALIDATE_BOOLEAN
        );
    }

    public function monthlyLimit(): int
    {
        return max(0, (int) Setting::get(
            'settings::modules:ai:budget:monthly_tokens',
            config('modules.ai.budget.monthly_tokens', 2000000)
        ));
    }

    /**
     * Tokens this user has spent in the current calendar month.
     */
    public function usedThisMonth(User $user): int
    {
        return (int) AiUsageLog::query()
            ->where('user_id', $user->id)
            ->where('created_at', '>=', Carbon::now()->startOfMonth())
            ->sum('total_tokens');
    }

    public function remaining(User $user): int
    {
        return max(0, $this->monthlyLimit() - $this->usedThisMonth($user));
    }

    /**
     * Refuse a turn that would start over budget.
     *
     * Owners are exempt: locking the operator out of their own diagnostics
     * because a limit they set was reached helps nobody.
     */
    public function assertWithinBudget(User $user): void
    {
        if (!$this->enforced() || $user->isOwner()) {
            return;
        }

        $limit = $this->monthlyLimit();

        if ($limit > 0 && $this->usedThisMonth($user) >= $limit) {
            abort(429, 'You have used your AI allowance for this month. It resets at the start of next month.');
        }
    }

    /**
     * Snapshot for the account and admin surfaces.
     */
    public function summary(User $user): array
    {
        $limit = $this->monthlyLimit();
        $used = $this->usedThisMonth($user);

        return [
            'enforced' => $this->enforced(),
            'limit' => $limit,
            'used' => $used,
            'remaining' => max(0, $limit - $used),
            'resets_at' => Carbon::now()->startOfMonth()->addMonth()->toIso8601String(),
        ];
    }
}
