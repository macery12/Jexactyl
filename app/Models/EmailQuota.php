<?php

namespace Everest\Models;

/**
 * Everest\Models\EmailQuota.
 *
 * @property int $id
 * @property int $user_id
 * @property string $plan
 * @property int $monthly_limit
 * @property int|null $daily_limit
 * @property int $monthly_sent
 * @property int $daily_sent
 * @property int $monthly_overage
 * @property \Carbon\Carbon $month_reset_at
 * @property \Carbon\Carbon $day_reset_at
 * @property \Illuminate\Support\Carbon $created_at
 * @property \Illuminate\Support\Carbon $updated_at
 */
class EmailQuota extends Model
{
    protected $table = 'email_quotas';

    protected $fillable = [
        'user_id',
        'plan',
        'monthly_limit',
        'daily_limit',
        'monthly_sent',
        'daily_sent',
        'monthly_overage',
        'month_reset_at',
        'day_reset_at',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'monthly_limit' => 'integer',
        'daily_limit' => 'integer',
        'monthly_sent' => 'integer',
        'daily_sent' => 'integer',
        'monthly_overage' => 'integer',
        'month_reset_at' => 'date',
        'day_reset_at' => 'date',
    ];

    /**
     * Plans configuration.
     */
    public const PLANS = [
        'free' => [
            'monthly_limit' => 3000,
            'daily_limit' => 100,
            'overage_allowed' => false,
        ],
        'pro' => [
            'monthly_limit' => 50000,
            'daily_limit' => null,
            'overage_allowed' => true,
        ],
        'scale' => [
            'monthly_limit' => 100000,
            'daily_limit' => null,
            'overage_allowed' => true,
        ],
    ];

    /**
     * Overage cost per 1000 emails.
     */
    public const OVERAGE_COST_PER_1000 = 0.90;

    /**
     * Get or create quota for a user.
     */
    public static function getOrCreateForUser(int $userId, string $plan = 'free'): self
    {
        return static::firstOrCreate(
            ['user_id' => $userId],
            [
                'plan' => $plan,
                'monthly_limit' => self::PLANS[$plan]['monthly_limit'],
                'daily_limit' => self::PLANS[$plan]['daily_limit'],
                'month_reset_at' => now()->startOfMonth(),
                'day_reset_at' => now()->startOfDay(),
            ]
        );
    }

    /**
     * Check if quota needs to be reset.
     */
    public function checkAndResetQuota(): void
    {
        $now = now();

        // Reset monthly if needed
        if ($this->month_reset_at->lt($now->copy()->startOfMonth())) {
            $this->monthly_sent = 0;
            $this->monthly_overage = 0;
            $this->month_reset_at = $now->copy()->startOfMonth();
        }

        // Reset daily if needed
        if ($this->day_reset_at->lt($now->copy()->startOfDay())) {
            $this->daily_sent = 0;
            $this->day_reset_at = $now->copy()->startOfDay();
        }

        $this->save();
    }

    /**
     * Try to reserve quota for sending emails.
     * Returns true if quota available, false otherwise.
     */
    public function reserveQuota(int $count = 1): bool
    {
        $this->checkAndResetQuota();

        $planConfig = self::PLANS[$this->plan] ?? self::PLANS['free'];

        // Check daily limit (if applicable)
        if ($planConfig['daily_limit'] !== null) {
            if ($this->daily_sent + $count > $planConfig['daily_limit']) {
                return false;
            }
        }

        // Check monthly limit
        if ($this->monthly_sent + $count > $this->monthly_limit) {
            // If overage allowed, track it
            if ($planConfig['overage_allowed']) {
                $overage = ($this->monthly_sent + $count) - $this->monthly_limit;
                $this->monthly_overage += $overage;
            } else {
                return false;
            }
        }

        // Reserve quota
        $this->monthly_sent += $count;
        if ($planConfig['daily_limit'] !== null) {
            $this->daily_sent += $count;
        }

        $this->save();

        return true;
    }

    /**
     * Calculate when the next quota will be available.
     */
    public function getNextAvailableTime(): \Carbon\Carbon
    {
        $this->checkAndResetQuota();

        $planConfig = self::PLANS[$this->plan] ?? self::PLANS['free'];

        // If daily limit hit, return next day
        if ($planConfig['daily_limit'] !== null && $this->daily_sent >= $planConfig['daily_limit']) {
            return now()->addDay()->startOfDay();
        }

        // If monthly limit hit and no overage allowed, return next month
        if ($this->monthly_sent >= $this->monthly_limit && !$planConfig['overage_allowed']) {
            return now()->addMonth()->startOfMonth();
        }

        // Otherwise, available now
        return now();
    }

    /**
     * Get remaining quota.
     */
    public function getRemainingQuota(): array
    {
        $this->checkAndResetQuota();

        $planConfig = self::PLANS[$this->plan] ?? self::PLANS['free'];

        return [
            'daily_remaining' => $planConfig['daily_limit'] !== null
                ? max(0, $planConfig['daily_limit'] - $this->daily_sent)
                : null,
            'monthly_remaining' => max(0, $this->monthly_limit - $this->monthly_sent),
            'overage' => $this->monthly_overage,
            'overage_cost' => $this->monthly_overage > 0
                ? round(($this->monthly_overage / 1000) * self::OVERAGE_COST_PER_1000, 2)
                : 0,
        ];
    }
}
