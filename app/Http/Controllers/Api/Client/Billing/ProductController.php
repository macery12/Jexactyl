<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Illuminate\Support\Facades\Cache;
use Everest\Models\Billing\BillingException;
use Everest\Transformers\Api\Client\ProductTransformer;
use Everest\Http\Controllers\Api\Client\ClientApiController;

class ProductController extends ClientApiController
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Returns all the products that have been configured.
     */
    public function index(int $id): array
    {
        $category = Category::findOrFail($id);

        // Per-category product list is a hot storefront read; cache briefly to absorb
        // concurrent load. Staleness is bounded to the TTL.
        $products = Cache::remember(
            "billing.storefront.products.{$category->uuid}",
            60,
            fn () => Product::where('category_uuid', $category->uuid)
                // NULL means the row predates visibility ever being persisted;
                // those stay on the storefront. Only an explicit false hides.
                ->where(fn ($q) => $q->where('visible', true)->orWhereNull('visible'))
                ->get(),
        );

        if ($products->isEmpty()) {
            BillingException::create([
                'title' => 'No products in category ' . $category->name . ' are visible',
                'exception_type' => BillingException::TYPE_STOREFRONT,
                'description' => 'Go to this category and create a visible product',
            ]);
        }

        return $this->fractal->collection($products)
            ->transformWith(ProductTransformer::class)
            ->toArray();
    }

    /**
     * View a specific product.
     */
    public function view(int $id)
    {
        $product = Product::findOrFail($id);

        return $this->fractal->item($product)
            ->transformWith(ProductTransformer::class)
            ->toArray();
    }
}
