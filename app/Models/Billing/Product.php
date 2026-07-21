<?php

namespace Everest\Models\Billing;

use Everest\Models\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property string $uuid
 * @property string $category_uuid
 * @property string $name
 * @property string $icon
 * @property float $price
 * @property string $description
 * @property int $cpu_limit
 * @property int $memory_limit
 * @property int $disk_limit
 * @property int $backup_limit
 * @property int $database_limit
 * @property int $allocation_limit
 * @property int|null $subdomain_limit
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 * @property-read \Everest\Models\Billing\Category|null $category
 */
class Product extends Model
{
    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'product';

    /**
     * The table associated with the model.
     */
    protected $table = 'products';

    /**
     * Fields that are mass assignable.
     */
    protected $fillable = [
        'uuid', 'category_uuid',
        'name', 'icon', 'price', 'description', 'visible',
        'cpu_limit', 'memory_limit', 'disk_limit',
        'backup_limit', 'database_limit', 'allocation_limit', 'subdomain_limit',
    ];

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'price' => 'float',
        'visible' => 'boolean',
        'cpu_limit' => 'integer',
        'memory_limit' => 'integer',
        'disk_limit' => 'integer',
        'backup_limit' => 'integer',
        'database_limit' => 'integer',
        'allocation_limit' => 'integer',
        'subdomain_limit' => 'integer',
    ];

    public static array $validationRules = [
        'uuid' => 'required|string|size:36',
        'category_uuid' => 'string|exists:categories,uuid',

        'name' => 'required|string|min:3|max:191',
        'icon' => 'nullable|string|min:3|max:300',
        'price' => 'required',
        'description' => 'nullable|string|max:300',
        'visible' => 'nullable|bool',

        'cpu_limit' => 'required|integer',
        'memory_limit' => 'required|integer',
        'disk_limit' => 'required|integer',

        'backup_limit' => 'required|integer',
        'database_limit' => 'required|integer',
        'allocation_limit' => 'required|integer',
        'subdomain_limit' => 'nullable|integer|min:0',
    ];

    /**
     * Gets information for the category associated with this product.
     *
     * @return BelongsTo<Category, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class, 'category_uuid', 'uuid');
    }

    /**
     * Determine if this product is free.
     */
    public function isFree(): bool
    {
        return (float) $this->price === 0.0;
    }

    /**
     * Get the renewal period in days for this product.
     */
    public function getRenewalDays(): int
    {
        return $this->isFree()
            ? config('modules.billing.renewal.free_renewal_days', 30)
            : config('modules.billing.renewal.days', 30);
    }

    /**
     * Calculate suspension threshold based on billing cycle length.
     * Uses a capped percentage-based model with maximum 7-day grace period.
     *
     * Formula: min(max(billingDays * 20%, 3), 7)
     * - 7-day cycle → 3 days (minimum)
     * - 30-day cycle → 6 days
     * - 90-day cycle → 7 days (capped)
     * - 180+ day cycle → 7 days (capped)
     *
     * @param int $billingDays The billing cycle length in days
     *
     * @return int The suspension threshold in days
     */
    public function getSuspensionThresholdForBillingCycle(int $billingDays): int
    {
        // Free products always use short threshold
        if ($this->isFree()) {
            return config('modules.billing.renewal.free_suspension_days', 7);
        }

        // Calculate threshold as percentage of billing cycle
        $percentage = config('modules.billing.renewal.suspension_threshold_percentage', 0.20);
        $calculatedThreshold = (int) ceil($billingDays * $percentage);

        // Apply min/max bounds (3 days minimum, 7 days maximum)
        $minThreshold = config('modules.billing.renewal.min_suspension_threshold_days', 3);
        $maxThreshold = config('modules.billing.renewal.max_suspension_threshold_days', 7);

        return max($minThreshold, min($maxThreshold, $calculatedThreshold));
    }

    /**
     * Get all billing cycles for this product.
     */
    public function billingCycles(): HasMany
    {
        return $this->hasMany(BillingCycle::class);
    }

    /**
     * Get enabled billing cycles for this product.
     */
    public function enabledBillingCycles(): HasMany
    {
        return $this->hasMany(BillingCycle::class)->where('is_enabled', true);
    }

    /**
     * Calculate price for a specific billing cycle.
     *
     * Delegates to BillingCycleService. Call sites may switch directly to
     * BillingCycleService::calculatePrice() — this shim will be removed in Phase 3.
     *
     * @param int $days Number of billing days
     * @param int|null $nodeId Optional node ID to apply node pricing multiplier
     *
     * @return array ['price' => float, 'multiplier' => float, 'discount_percent' => float, 'node_multiplier' => float]
     */
    public function calculatePrice(int $days, ?int $nodeId = null): array
    {
        return app(\Everest\Services\Billing\BillingCycleService::class)->calculatePrice($this, $days, $nodeId);
    }
}
