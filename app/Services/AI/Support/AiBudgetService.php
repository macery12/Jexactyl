<?php

namespace Everest\Services\AI\Support;

use Everest\Models\User;
use Everest\Models\Setting;
use Illuminate\Support\Str;
use Everest\Models\AiUsageLog;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

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

    /** Extra recovery margin beyond queueing plus the turn wall limit. */
    private const RESERVATION_MARGIN_SECONDS = 60;

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

        // With enforcement enabled, zero means zero allowance. Treating it as
        // unlimited made the strongest-looking configuration disable the
        // control entirely.
        if ($this->usedThisMonth($user) >= $limit) {
            abort(429, 'You have used your AI allowance for this month. It resets at the start of next month.');
        }
    }

    /**
     * Atomically admit one budgeted turn for a user.
     *
     * Actual token cost is not knowable before inference. Instead of guessing
     * an amount, serialize this user's admission until the completed leg has
     * upserted its cumulative total. The users-row lock makes the usage check
     * and durable lease creation one decision across PHP workers.
     */
    public function reserve(User $user): AiBudgetReservation
    {
        if (!$this->enforced() || $user->isOwner()) {
            return AiBudgetReservation::passthrough();
        }

        $token = (string) Str::uuid();

        DB::transaction(function () use ($user, $token): void {
            User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            DB::table('ai_budget_reservations')
                ->where('user_id', $user->id)
                ->where('expires_at', '<=', now())
                ->delete();

            if (DB::table('ai_budget_reservations')->where('user_id', $user->id)->exists()) {
                abort(429, 'You already have an AI request running. Wait for it to finish before starting another.');
            }

            $this->assertWithinBudget($user);

            DB::table('ai_budget_reservations')->insert([
                'user_id' => $user->id,
                'token' => $token,
                'expires_at' => now()->addSeconds($this->reservationTtlSeconds()),
                'created_at' => now(),
            ]);
        }, 3);

        return AiBudgetReservation::held(function () use ($user, $token): void {
            DB::table('ai_budget_reservations')
                ->where('user_id', $user->id)
                ->where('token', $token)
                ->delete();
        });
    }

    protected function reservationTtlSeconds(): int
    {
        $wall = max(30, (int) Setting::get(
            'settings::modules:ai:agent:max_wall_seconds',
            config('modules.ai.agent.max_wall_seconds', 180)
        ));
        $wait = max(5, (int) Setting::get(
            'settings::modules:ai:concurrency:max_wait_seconds',
            config('modules.ai.concurrency.max_wait_seconds', 120)
        ));

        return $wall + $wait + self::RESERVATION_MARGIN_SECONDS;
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
