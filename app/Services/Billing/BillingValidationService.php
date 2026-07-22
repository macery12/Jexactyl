<?php

namespace Everest\Services\Billing;

use Everest\Models\Node;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;

/**
 * Centralized validation service for billing operations.
 *
 * This service consolidates all billing-related validation logic that was previously
 * duplicated across the old FreeProductController and PaymentController (now replaced by CheckoutController).
 */
class BillingValidationService
{
    /**
     * Threshold for treating a price as effectively zero, to absorb floating point residuals.
     * Uses $0.0001 (0.01 cents) so near-zero or negative totals from rounding/coupons are handled as free.
     */
    private const PRICE_EPSILON = 0.0001;

    public function __construct(
        private NodeAvailabilityService $nodeAvailabilityService,
        private BillingCycleService $billingCycleService,
    ) {
    }

    /**
     * Validate node selection for a product before checkout processing.
     *
     * @throws DisplayException
     */
    public function validateNodeSelectionForProduct(?int $nodeId, Product $product): void
    {
        $availableNodes = $this->nodeAvailabilityService->getAvailableNodesForProduct($product);

        if ($availableNodes->isEmpty()) {
            throw new DisplayException('No nodes are available for this product. Please contact support.');
        }

        if (empty($nodeId)) {
            throw new DisplayException('Please select a node to continue.');
        }

        $availableNodeIds = $availableNodes->pluck('id')->map(static fn ($id) => (int) $id)->all();
        if (!in_array((int) $nodeId, $availableNodeIds, true)) {
            throw new DisplayException('The selected node is not available for this product.');
        }
    }

    /**
     * Validate that the billing module is enabled.
     *
     * @throws DisplayException if billing is disabled
     */
    public function validateBillingEnabled(): void
    {
        if (!config('modules.billing.enabled')) {
            throw new DisplayException('The billing module is not enabled.');
        }
    }

    /**
     * Validate that a node can accept deployments of a specific type.
     *
     * @param int $nodeId The node ID to validate
     * @param bool $isFreeProduct Whether this is a free product
     *
     * @throws DisplayException if the node cannot accept the deployment
     */
    public function validateNodeDeployment(int $nodeId, bool $isFreeProduct): void
    {
        $node = Node::findOrFail($nodeId);

        if ($isFreeProduct) {
            if (!$node->deployable_free) {
                throw new DisplayException('Free servers cannot be deployed to this node.');
            }
        } else {
            if (!$node->deployable) {
                throw new DisplayException('Paid servers cannot be deployed to this node.');
            }
        }
    }

    /**
     * Validate and return the egg ID for a product.
     *
     * @param Product $product The product being purchased
     * @param int|null $requestedEggId The egg ID requested by the user (optional)
     *
     * @return int The validated egg ID to use
     *
     * @throws DisplayException if the requested egg is not allowed
     */
    public function validateAndGetEggId(Product $product, ?int $requestedEggId): int
    {
        $allowedEggs = $product->category->getAllowedEggs();

        if ($requestedEggId) {
            if (!in_array($requestedEggId, $allowedEggs)) {
                throw new DisplayException('The selected egg is not allowed for this product category.');
            }

            return $requestedEggId;
        }

        // Default to the category's default egg if none selected
        return $product->category->getDefaultEggId();
    }

    /**
     * Calculate the final price after applying a coupon.
     *
     * SECURITY: This method now validates coupon eligibility including:
     * - Active status
     * - Expiration
     * - Max uses (global and per-user)
     * - Minimum order total
     * - Order type (new/renewal)
     *
     * @param Product $product The product being purchased
     * @param int|null $couponId The coupon ID to apply (optional)
     * @param string $orderType The order type (default: 'new')
     * @param int|null $billingDays The billing cycle days (optional, defaults to 30)
     * @param int|null $nodeId The node ID for location-based pricing (optional)
     * @param int|null $userId The user ID for per-user coupon validation (required if coupon is used)
     *
     * @return array{finalPrice: float, discount: float} The final price and discount amount
     *
     * @throws DisplayException if coupon validation fails
     */
    public function calculatePriceWithCoupon(Product $product, ?int $couponId, string $orderType = 'new', ?int $billingDays = null, ?int $nodeId = null, ?int $userId = null): array
    {
        // Delegate to BillingCycleService — pricing logic lives there now.
        return $this->billingCycleService->calculatePriceWithCoupon(
            $product,
            $couponId,
            $orderType,
            $billingDays,
            $nodeId,
            $userId
        );
    }

    /**
     * Validate that the final price matches the expected billing type.
     *
     * @param float $finalPrice The final price after discounts
     * @param bool $expectFree Whether we expect the price to be free
     *
     * @throws DisplayException if the price doesn't match expectations
     */
    public function validatePriceType(float $finalPrice, bool $expectFree): void
    {
        // Treat very small residuals as free (and clamp any negative totals up to zero)
        $normalizedPrice = max(0, (float) $finalPrice);
        $isFree = $normalizedPrice <= self::PRICE_EPSILON;

        if ($expectFree && !$isFree) {
            throw new DisplayException('This product is not free. Please use the payment process.');
        }

        if (!$expectFree && $isFree) {
            throw new DisplayException('This order total is $0. Please use the free order process instead of payment.');
        }
    }

    /**
     * Validate that a user doesn't already own a free product.
     * This only applies to originally free products (not made free by coupon).
     *
     * @param int $userId The user ID
     * @param Product $product The product being purchased
     *
     * @throws DisplayException if user already owns a free product
     */
    public function validateFreeProductOwnership(int $userId, Product $product): void
    {
        // Only check for originally free products
        if ((float) $product->price === 0.0) {
            $existingCount = Server::where('owner_id', $userId)
                ->where('billing_product_id', $product->id)
                ->count();

            if ($existingCount > 0) {
                throw new DisplayException('You already own one of this free product. Nice try!');
            }
        }
    }
}
