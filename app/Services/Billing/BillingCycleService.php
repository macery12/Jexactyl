<?php

namespace Everest\Services\Billing;

use Everest\Models\Setting;
use Everest\Models\Billing\Coupon;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\BillingCycle;
use Everest\Services\Billing\BillingDefaults;

class BillingCycleService
{
    /**
     * Calculate price for a product with a specific billing cycle.
     *
     * @param int|null $nodeId Optional node ID to apply node pricing multiplier
     */
    public function calculatePrice(Product $product, int $billingDays, ?int $nodeId = null): array
    {
        $defaultBillingDays = BillingDefaults::defaultBillingDays();
        $basePrice = (float) $product->price;
        $perDayPrice = $basePrice / $defaultBillingDays;

        // Get multiplier steps from settings
        $stepsJson = Setting::get('settings::modules:billing:renewal:multiplier_steps');
        $steps = [];

        if ($stepsJson) {
            $decoded = json_decode($stepsJson, true);
            if (is_array($decoded)) {
                $steps = $decoded;
                usort($steps, fn ($a, $b) => $a['maxDays'] <=> $b['maxDays']);
            }
        }

        // Default steps if none configured
        if (empty($steps)) {
            $steps = [
                ['maxDays' => 10, 'multiplier' => 1.30],
                ['maxDays' => 20, 'multiplier' => 1.20],
                ['maxDays' => 29, 'multiplier' => 1.10],
                ['maxDays' => 30, 'multiplier' => 1.00],
                ['maxDays' => 59, 'multiplier' => 0.95],
                ['maxDays' => 89, 'multiplier' => 0.90],
                ['maxDays' => 999, 'multiplier' => 0.85],
            ];
        }

        // Find the first matching step (billing cycle multiplier)
        $billingMultiplier = 1.0;
        $matchedStep = false;
        foreach ($steps as $step) {
            if ($billingDays <= $step['maxDays']) {
                $billingMultiplier = $step['multiplier'];
                $matchedStep = true;
                break;
            }
        }

        // If no step matched (days > all maxDays), use the last step's multiplier
        if (!$matchedStep && !empty($steps)) {
            $billingMultiplier = end($steps)['multiplier'];
        }

        // Get node pricing multiplier (default to 1.0 if node not found or no node specified)
        $nodeMultiplier = 1.0;
        if ($nodeId) {
            $node = \Everest\Models\Node::find($nodeId);
            if ($node && isset($node->price_multiplier)) {
                $nodeMultiplier = (float) $node->price_multiplier;
            }
        }

        // Calculate final price: per_day_price * days * billing_multiplier * node_multiplier
        $finalPrice = round($perDayPrice * $billingDays * $billingMultiplier * $nodeMultiplier, 2);

        // Calculate discount percentage (negative = premium, positive = discount)
        $standardPrice = $perDayPrice * $billingDays;
        $discountPercent = $standardPrice > 0 ? (($standardPrice - $finalPrice) / $standardPrice) * 100 : 0;

        return [
            'price' => $finalPrice,
            'multiplier' => $billingMultiplier,
            'node_multiplier' => $nodeMultiplier,
            'discount_percent' => round($discountPercent, 1),
        ];
    }

    /**
     * Get all billing cycles for a product (admin view).
     * Includes all cycles with their enabled status.
     */
    public function getAllCycles(Product $product): array
    {
        // Get default billing days from settings
        $defaultBillingDays = BillingDefaults::defaultBillingDays();

        // Query ALL billing cycles for the product
        $cycles = BillingCycle::where('product_id', $product->id)
            ->orderBy('days')
            ->get();

        // If no billing cycles defined, return default cycle based on global setting
        if ($cycles->isEmpty()) {
            $priceInfo = $this->calculatePrice($product, $defaultBillingDays);

            return [
                [
                    'days' => $defaultBillingDays,
                    'price' => $priceInfo['price'],
                    'multiplier' => $priceInfo['multiplier'],
                    'discount_percent' => $priceInfo['discount_percent'],
                    'is_default' => true,
                    'is_enabled' => true,
                ],
            ];
        }

        $result = [];
        foreach ($cycles as $cycle) {
            $priceInfo = $this->calculatePrice($product, $cycle->days);
            $result[] = [
                'id' => $cycle->id,
                'days' => $cycle->days,
                'price' => $priceInfo['price'],
                'multiplier' => $priceInfo['multiplier'],
                'discount_percent' => $priceInfo['discount_percent'],
                'is_default' => $cycle->days === $defaultBillingDays,
                'is_enabled' => $cycle->is_enabled,
            ];
        }

        return $result;
    }

    /**
     * Get all enabled billing cycles for a product with calculated prices.
     * Used for client checkout.
     *
     * @param int|null $couponId Optional coupon ID to apply
     */
    public function getAvailableCycles(Product $product, ?int $couponId = null): array
    {
        // Get default billing days from settings
        $defaultBillingDays = BillingDefaults::defaultBillingDays();

        // Query enabled billing cycles directly with proper where clause
        $cycles = BillingCycle::where('product_id', $product->id)
            ->where('is_enabled', true)
            ->orderBy('days')
            ->get();

        // If no billing cycles defined, return default cycle based on global setting
        if ($cycles->isEmpty()) {
            $priceInfo = $this->calculatePrice($product, $defaultBillingDays);

            return [
                [
                    'days' => $defaultBillingDays,
                    'price' => $priceInfo['price'],
                    'multiplier' => $priceInfo['multiplier'],
                    'discount_percent' => $priceInfo['discount_percent'],
                    'is_default' => true,
                ],
            ];
        }

        $result = [];
        foreach ($cycles as $cycle) {
            $priceInfo = $this->calculatePrice($product, $cycle->days);
            $result[] = [
                'id' => $cycle->id,
                'days' => $cycle->days,
                'price' => $priceInfo['price'],
                'multiplier' => $priceInfo['multiplier'],
                'discount_percent' => $priceInfo['discount_percent'],
                'is_default' => $cycle->days === $defaultBillingDays,
            ];
        }

        return $result;
    }

    /**
     * Validate that a billing cycle is available for a product.
     *
     * When the product has custom billing cycles, only enabled cycles are accepted.
     * When the product has no custom cycles, only the current global default is accepted.
     *
     * @throws DisplayException
     */
    public function validateBillingCycle(Product $product, int $billingDays): void
    {
        $hasCycles = $product->billingCycles()->exists();

        if ($hasCycles) {
            $cycle = $product->billingCycles()
                ->where('days', $billingDays)
                ->where('is_enabled', true)
                ->first();

            if (!$cycle) {
                throw new DisplayException("The selected billing cycle ({$billingDays} days) is not available for this product.");
            }

            return;
        }

        // No custom cycles: only the current global default is accepted.
        $defaultBillingDays = BillingDefaults::defaultBillingDays();
        if ($billingDays !== $defaultBillingDays) {
            throw new DisplayException("The selected billing cycle ({$billingDays} days) is not available for this product. The default billing cycle is {$defaultBillingDays} days.");
        }
    }

    /**
     * Update billing cycle records across all products when the global default changes.
     *
     * Products that have exactly one billing cycle matching $oldDefault are treated as
     * using the system default and are updated to $newDefault. Products with no billing
     * cycles rely on the synthetic fallback and are unaffected. Products with multiple
     * billing cycles have manually configured cycles and are left unchanged.
     *
     * @param int $oldDefault The previous default billing days value
     * @param int $newDefault The new default billing days value
     */
    public function reseedDefaultBillingCycle(int $oldDefault, int $newDefault): void
    {
        if ($oldDefault === $newDefault) {
            return;
        }

        $products = Product::with('billingCycles')->get();

        foreach ($products as $product) {
            $cycles = $product->billingCycles;

            // Only update products with exactly one cycle that matches the old default.
            // Multi-cycle products have manually configured billing options; leave them alone.
            if ($cycles->count() === 1) {
                $cycle = $cycles->first();

                if ($cycle->days === $oldDefault) {
                    $cycle->update(['days' => $newDefault]);
                }
            }
        }
    }

    /**
     * Create or update billing cycles for a product.
     *
     * @param array $cycles Array of ['days' => int, 'is_enabled' => bool]
     */
    public function syncBillingCycles(Product $product, array $cycles): void
    {
        // Ensure we have a valid product ID
        if (!$product->id) {
            throw new \InvalidArgumentException('Product must have an ID to sync billing cycles');
        }

        // Log for debugging
        \Log::info('Syncing billing cycles', [
            'product_id' => $product->id,
            'product_name' => $product->name,
            'cycles_count' => count($cycles),
            'cycles' => $cycles,
        ]);

        $daysToKeep = [];

        foreach ($cycles as $cycleData) {
            $daysToKeep[] = $cycleData['days'];

            // Explicitly set product_id to ensure it's never null or wrong
            $cycle = BillingCycle::updateOrCreate(
                [
                    'product_id' => $product->id,
                    'days' => $cycleData['days'],
                ],
                [
                    'product_id' => $product->id,  // Explicitly set in update data too
                    'is_enabled' => $cycleData['is_enabled'] ?? true,
                ]
            );

            \Log::info('Created/Updated billing cycle', [
                'cycle_id' => $cycle->id,
                'product_id' => $cycle->product_id,
                'days' => $cycle->days,
                'is_enabled' => $cycle->is_enabled,
            ]);
        }

        // Delete cycles that are no longer in the list for THIS SPECIFIC PRODUCT
        $deleted = BillingCycle::where('product_id', $product->id)
            ->whereNotIn('days', $daysToKeep)
            ->get();

        \Log::info('Deleting billing cycles', [
            'product_id' => $product->id,
            'cycles_to_delete' => $deleted->pluck('id')->toArray(),
            'days_to_keep' => $daysToKeep,
        ]);

        BillingCycle::where('product_id', $product->id)
            ->whereNotIn('days', $daysToKeep)
            ->delete();
    }

    /**
     * Calculate the final price for a product after applying a coupon.
     *
     * Moved here from BillingValidationService so pricing logic is co-located
     * with other cycle/price calculations. BillingValidationService retains a
     * delegation shim for backwards compatibility.
     *
     * @throws DisplayException if coupon validation fails
     */
    public function calculatePriceWithCoupon(
        Product $product,
        ?int $couponId,
        string $orderType = 'new',
        ?int $billingDays = null,
        ?int $nodeId = null,
        ?int $userId = null
    ): array {
        $days = $billingDays ?? BillingDefaults::defaultBillingDays();

        if ($orderType !== 'ren') {
            $this->validateBillingCycle($product, $days);
        }

        $priceInfo = $product->calculatePrice($days, $nodeId);
        $basePrice = $priceInfo['price'];

        $finalPrice = round($basePrice, 2);
        $discount = 0.0;

        if ($couponId) {
            $coupon = Coupon::find($couponId);

            if (!$coupon) {
                throw new DisplayException('The specified coupon does not exist.');
            }

            if ($userId === null) {
                throw new DisplayException('User ID is required for coupon validation.');
            }

            $validation = $coupon->canBeUsed($userId, $basePrice);
            if (!$validation['valid']) {
                throw new DisplayException($validation['message']);
            }

            if (!$coupon->isAllowedForOrderType($orderType)) {
                $allowedTypes = [
                    Coupon::ALLOWED_FOR_PURCHASES => 'new purchases',
                    Coupon::ALLOWED_FOR_RENEWALS  => 'renewals',
                ];
                $allowed = $allowedTypes[$coupon->allowed_for] ?? $coupon->allowed_for;
                throw new DisplayException("This coupon is only valid for {$allowed}.");
            }

            $discount    = round($coupon->calculateDiscount($basePrice), 2);
            $finalPrice  = max(0, round($basePrice - $discount, 2));
        }

        return [
            'finalPrice'    => $finalPrice,
            'discount'      => $discount,
            'subtotal'      => $basePrice,
            'billingDays'   => $days,
            'multiplier'    => $priceInfo['multiplier'],
            'nodeMultiplier' => $priceInfo['node_multiplier'],
        ];
    }
}
