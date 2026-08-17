<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Everest\Models\Billing\BillingCycle;
use Everest\Services\Billing\BillingCycleService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Billing\BillingCycles\GetBillingCyclesRequest;
use Everest\Http\Requests\Api\Application\Billing\BillingCycles\SyncBillingCyclesRequest;
use Everest\Http\Requests\Api\Application\Billing\BillingCycles\DeleteBillingCycleRequest;

class BillingCycleController extends ApplicationApiController
{
    public function __construct(private BillingCycleService $billingCycleService)
    {
        parent::__construct();
    }

    /**
     * The product named in the URI, resolved through the category above it.
     *
     * `{category:id}/products/{product:id}/billing-cycles` reads as a chain of
     * containment, but these arrive as scalar parameters rather than bound
     * models, so `scopeBindings()` never sees them and the category was simply
     * unused. A mismatched pair now 404s at the first link, as the route shape
     * has always promised.
     */
    private function productIn(int $category, int $product): Product
    {
        $categoryModel = Category::findOrFail($category);

        return Product::query()
            ->where('category_uuid', $categoryModel->uuid)
            ->whereKey($product)
            ->firstOrFail();
    }

    /**
     * Get all billing cycles for a product with calculated prices.
     */
    public function index(GetBillingCyclesRequest $request, int $category, int $product): JsonResponse
    {
        // Use getAllCycles for admin to include is_enabled status
        $cycles = $this->billingCycleService->getAllCycles($this->productIn($category, $product));

        return response()->json(['data' => $cycles]);
    }

    /**
     * Sync billing cycles for a product.
     */
    public function sync(SyncBillingCyclesRequest $request, int $category, int $product): Response
    {
        $this->billingCycleService->syncBillingCycles(
            $this->productIn($category, $product),
            $request->validated()['cycles'],
        );

        return $this->returnNoContent();
    }

    /**
     * Delete a specific billing cycle.
     */
    public function delete(DeleteBillingCycleRequest $request, int $category, int $product, int $cycle): Response
    {
        // Every link in the chain, not just the last one: scoping the cycle to
        // its product while leaving the product unscoped checks half a claim.
        $cycleModel = BillingCycle::where('product_id', $this->productIn($category, $product)->id)
            ->where('id', $cycle)
            ->firstOrFail();

        $cycleModel->delete();

        return $this->returnNoContent();
    }
}
