<?php

namespace Everest\Http\Controllers\Api\Pub;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Everest\Http\Controllers\Controller;
use Everest\Services\Landing\LandingConfigService;
use Everest\Transformers\Api\Pub\PublicProductTransformer;
use Everest\Transformers\Api\Pub\PublicCategoryTransformer;

/**
 * Unauthenticated, rate-limited storefront catalog for the public landing page.
 *
 * Returns only the slim, public-safe shape needed to render storefront cards.
 * The catalog is gated behind both the billing module and the landing-page
 * pricing section — we never leak the catalog unless an operator has opted in.
 */
class PublicStorefrontController extends Controller
{
    public function __construct(private LandingConfigService $landing)
    {
    }

    public function catalog(): JsonResponse
    {
        if (!config('modules.billing.enabled') || !$this->landing->isPricingEnabled()) {
            return new JsonResponse(['data' => []]);
        }

        $categories = Cache::remember(
            'billing.storefront.categories',
            60,
            fn () => Category::where('visible', true)->get(),
        );

        $categoryTransformer = new PublicCategoryTransformer();
        $productTransformer = new PublicProductTransformer();

        $data = $categories->map(function (Category $category) use ($categoryTransformer, $productTransformer) {
            // Mirror the authenticated storefront controllers' proven query +
            // cache keys so an admin product edit invalidates consistently.
            $products = Cache::remember(
                "billing.storefront.products.{$category->uuid}",
                60,
                fn () => Product::where('category_uuid', $category->uuid)->get(),
            );

            return array_merge(
                $categoryTransformer->transform($category),
                ['products' => $products->map(fn (Product $p) => $productTransformer->transform($p))->values()->all()],
            );
        })->values();

        return new JsonResponse(['data' => $data]);
    }
}
