<?php

namespace Everest\Models\Billing;

use Everest\Models\Model;
use Illuminate\Support\Str;

/**
 * @property int $id
 * @property string $code
 * @property string $type
 * @property float $value
 * @property int|null $max_uses
 * @property int|null $max_uses_per_user
 * @property float|null $min_order_total
 * @property \Carbon\Carbon|null $expires_at
 * @property bool $is_active
 * @property string $allowed_for
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 */
class Coupon extends Model
{
    public const TYPE_PERCENTAGE = 'percentage';
    public const TYPE_FIXED = 'fixed';

    public const ALLOWED_FOR_BOTH = 'both';
    public const ALLOWED_FOR_PURCHASES = 'purchases';
    public const ALLOWED_FOR_RENEWALS = 'renewals';

    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'coupon';

    /**
     * The table associated with the model.
     */
    protected $table = 'coupons';

    /**
     * Fields that are mass assignable.
     */
    protected $fillable = [
        'code',
        'type',
        'value',
        'max_uses',
        'max_uses_per_user',
        'min_order_total',
        'expires_at',
        'is_active',
        'allowed_for',
    ];

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'value' => 'float',
        'max_uses' => 'int',
        'max_uses_per_user' => 'int',
        'min_order_total' => 'float',
        'expires_at' => 'datetime',
        'is_active' => 'bool',
        'allowed_for' => 'string',
    ];

    /**
     * Default values for model attributes.
     */
    protected $attributes = [
        'allowed_for' => self::ALLOWED_FOR_BOTH,
    ];

    /**
     * Validation rules for the model.
     */
    public static array $validationRules = [
        'code' => 'required|string|max:50|unique:coupons,code',
        'type' => 'required|in:percentage,fixed',
        'value' => 'required|numeric|min:0',
        'max_uses' => 'nullable|integer|min:1',
        'max_uses_per_user' => 'nullable|integer|min:1',
        'min_order_total' => 'nullable|numeric|min:0',
        'expires_at' => 'nullable|date',
        'is_active' => 'boolean',
        'allowed_for' => 'nullable|in:both,purchases,renewals',
    ];

    /**
     * Boot the model and set the code to uppercase.
     */
    protected static function boot()
    {
        parent::boot();

        static::saving(function ($coupon) {
            $coupon->code = Str::upper($coupon->code);
        });
    }

    /**
     * Get the usage records for this coupon.
     */
    public function usage()
    {
        return $this->hasMany(CouponUsage::class);
    }

    /**
     * Get the total number of times this coupon has been used.
     */
    public function getUsageCountAttribute(): int
    {
        // If the usage_count was loaded via withCount(), use that value
        if (isset($this->attributes['usage_count'])) {
            return (int) $this->attributes['usage_count'];
        }

        return $this->usage()->count();
    }

    /**
     * Check if the coupon is expired.
     */
    public function isExpired(): bool
    {
        if ($this->expires_at === null) {
            return false;
        }

        return $this->expires_at->isPast();
    }

    /**
     * Check if the coupon has reached its max uses.
     */
    public function hasReachedMaxUses(): bool
    {
        if ($this->max_uses === null) {
            return false;
        }

        return $this->usage()->count() >= $this->max_uses;
    }

    /**
     * Check if a user has exceeded their per-user limit.
     */
    public function userHasExceededLimit(int $userId): bool
    {
        if ($this->max_uses_per_user === null) {
            return false;
        }

        return $this->usage()->where('user_id', $userId)->count() >= $this->max_uses_per_user;
    }

    /**
     * Calculate the discount for a given subtotal.
     */
    public function calculateDiscount(float $subtotal): float
    {
        $discount = 0.0;

        if ($this->type === self::TYPE_PERCENTAGE) {
            $discount = $subtotal * ($this->value / 100);
        } elseif ($this->type === self::TYPE_FIXED) {
            $discount = $this->value;
        }

        // Ensure discount doesn't exceed subtotal
        return min($discount, $subtotal);
    }

    /**
     * Validate if the coupon can be used for a given order.
     */
    public function canBeUsed(int $userId, float $orderTotal): array
    {
        if (!$this->is_active) {
            return ['valid' => false, 'message' => 'This coupon is not active.'];
        }

        if ($this->isExpired()) {
            return ['valid' => false, 'message' => 'This coupon has expired.'];
        }

        if ($this->hasReachedMaxUses()) {
            return ['valid' => false, 'message' => 'This coupon has reached its maximum usage limit.'];
        }

        if ($this->userHasExceededLimit($userId)) {
            return ['valid' => false, 'message' => 'You have already used this coupon the maximum number of times.'];
        }

        if ($this->min_order_total !== null && $orderTotal < $this->min_order_total) {
            return [
                'valid' => false,
                'message' => sprintf(
                    'Order total must be at least %s to use this coupon.',
                    number_format($this->min_order_total, 2)
                ),
            ];
        }

        return ['valid' => true, 'message' => 'Coupon is valid.'];
    }

    /**
     * Authoritative reservation check for use while this coupon row is locked.
     *
     * The explicit locking read is a current read under MySQL REPEATABLE READ;
     * ordinary relationship counts could otherwise reuse a snapshot created
     * before this transaction waited for the coupon lock.
     */
    public function canBeReserved(int $userId, float $orderTotal): array
    {
        if (!$this->is_active) {
            return ['valid' => false, 'message' => 'This coupon is not active.'];
        }

        if ($this->isExpired()) {
            return ['valid' => false, 'message' => 'This coupon has expired.'];
        }

        $usage = $this->usage()
            ->lockForUpdate()
            ->get(['id', 'user_id']);
        if ($this->max_uses !== null && $usage->count() >= $this->max_uses) {
            return ['valid' => false, 'message' => 'This coupon has reached its maximum usage limit.'];
        }

        if (
            $this->max_uses_per_user !== null
            && $usage->where('user_id', $userId)->count() >= $this->max_uses_per_user
        ) {
            return ['valid' => false, 'message' => 'You have already used this coupon the maximum number of times.'];
        }

        if ($this->min_order_total !== null && $orderTotal < $this->min_order_total) {
            return [
                'valid' => false,
                'message' => sprintf(
                    'Order total must be at least %s to use this coupon.',
                    number_format($this->min_order_total, 2)
                ),
            ];
        }

        return ['valid' => true, 'message' => 'Coupon is valid.'];
    }

    /**
     * Check if this coupon is allowed for a specific order type.
     *
     * @param string $orderType The order type ('new', 'ren', 'upg')
     *
     * @return bool True if the coupon is allowed for this order type
     */
    public function isAllowedForOrderType(string $orderType): bool
    {
        $allowedFor = $this->allowed_for ?? self::ALLOWED_FOR_BOTH;

        if ($allowedFor === self::ALLOWED_FOR_BOTH) {
            return true;
        }

        // Treat both 'new' and 'upg' as purchases
        if ($allowedFor === self::ALLOWED_FOR_PURCHASES && in_array($orderType, ['new', 'upg'])) {
            return true;
        }

        if ($allowedFor === self::ALLOWED_FOR_RENEWALS && $orderType === 'ren') {
            return true;
        }

        return false;
    }

    /**
     * Get a human-readable message for when a coupon is not allowed for an order type.
     *
     * @param string $orderType The order type ('new', 'ren', 'upg')
     *
     * @return string Error message
     */
    public function getNotAllowedMessage(string $orderType): string
    {
        $allowedFor = $this->allowed_for ?? self::ALLOWED_FOR_BOTH;

        if ($allowedFor === self::ALLOWED_FOR_PURCHASES) {
            return 'This coupon can only be used for new purchases.';
        }

        if ($allowedFor === self::ALLOWED_FOR_RENEWALS) {
            return 'This coupon can only be used for renewals.';
        }

        return 'This coupon is not valid for this order type.';
    }
}
