<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Ramsey\Uuid\Uuid;
use Everest\Models\Server;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Illuminate\Support\Facades\Cache;
use Spatie\QueryBuilder\QueryBuilder;
use Everest\Exceptions\DisplayException;
use Everest\Services\Billing\BillingCycleService;
use Everest\Transformers\Api\Application\ProductTransformer;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Billing\Products\GetBillingProductRequest;
use Everest\Http\Requests\Api\Application\Billing\Products\GetBillingProductsRequest;
use Everest\Http\Requests\Api\Application\Billing\Products\StoreBillingProductRequest;
use Everest\Http\Requests\Api\Application\Billing\Products\DeleteBillingProductRequest;
use Everest\Http\Requests\Api\Application\Billing\Products\UpdateBillingProductRequest;

class ProductController extends ApplicationApiController
{
    /**
     * ProductController constructor.
     */
    public function __construct(private BillingCycleService $billingCycleService)
    {
        parent::__construct();
    }

    /**
     * Get all categories associated with the panel.
     */
    public function index(GetBillingProductsRequest $request, string $category): array
    {
        $perPage = (int) $request->query('per_page', '20');
        if ($perPage < 1 || $perPage > 100) {
            throw new QueryValueOutOfRangeHttpException('per_page', 1, 100);
        }

        $categoryModel = Category::findOrFail((int) $category);

        $products = QueryBuilder::for(Product::query())
            ->where('category_uuid', $categoryModel->uuid)
            ->allowedFilters(...['id', 'name'])
            ->allowedSorts(...['id', 'name', 'price'])
            ->paginate($perPage);

        return $this->fractal->collection($products)
            ->transformWith(ProductTransformer::class)
            ->toArray();
    }

    /**
     * Build the writable attributes shared by store() and update().
     *
     * Limits arrive nested under `limits` from the admin UI but are validated as
     * flat `*_limit` keys, so accept either shape rather than hard-indexing one.
     */
    private function attributesFrom(Request $request, ?bool $visibleDefault = true): array
    {
        $limit = function (string $key, int $default = 0) use ($request): int {
            $nested = $request->input("limits.$key");

            return (int) ($nested ?? $request->input("{$key}_limit") ?? $default);
        };

        // On update the caller may omit `visible` entirely; passing null as the
        // default drops the key so the stored value is preserved rather than
        // being silently reset to visible.
        $visible = $request->has('visible')
            ? ['visible' => $request->boolean('visible')]
            : ($visibleDefault === null ? [] : ['visible' => $visibleDefault]);

        return $visible + [
            'name' => $request->input('name'),
            'icon' => $request->input('icon'),
            // The single source of truth for what this plan costs: every cycle
            // price is derived from it. There is no separate billing basis.
            'price' => (float) $request->input('price'),
            'description' => $request->input('description'),
            'cpu_limit' => $limit('cpu'),
            'memory_limit' => $limit('memory'),
            'disk_limit' => $limit('disk'),
            'backup_limit' => $limit('backup'),
            'database_limit' => $limit('database'),
            'allocation_limit' => $limit('allocation'),
            'subdomain_limit' => $limit('subdomain', 1),
        ];
    }

    /**
     * Drop the storefront's cached product list for a category so visibility and
     * price edits show up immediately instead of after the 60s TTL.
     */
    private function flushStorefrontCache(string $categoryUuid): void
    {
        Cache::forget("billing.storefront.products.{$categoryUuid}");
    }

    /**
     * Store a new product category in the database.
     */
    public function store(StoreBillingProductRequest $request, string $category): JsonResponse
    {
        $categoryModel = Category::findOrFail((int) $category);

        // TODO(jex): clean this up, make a service or somethin'
        try {
            $product = Product::create($this->attributesFrom($request) + [
                'uuid' => Uuid::uuid4()->toString(),
                'category_uuid' => $categoryModel->uuid,
            ]);

            // Create default billing cycles if provided
            if ($request->has('billing_cycles')) {
                $this->billingCycleService->syncBillingCycles($product, $request->input('billing_cycles'));
            }

            $this->flushStorefrontCache($categoryModel->uuid);
        } catch (\Exception $ex) {
            throw new \Exception('Failed to create a new product: ' . $ex->getMessage());
        }

        Activity::event('admin:billing:products:create')
            ->property('product', $product)
            ->description('A new billing product was created')
            ->log();

        return $this->fractal->item($product)
            ->transformWith(ProductTransformer::class)
            ->respond(Response::HTTP_CREATED);
    }

    /**
     * Update an existing product.
     */
    public function update(UpdateBillingProductRequest $request, string $category, string $product): Response
    {
        $productModel = Product::findOrFail((int) $product);
        $attributes = $this->attributesFrom($request, null);

        try {
            $productModel = DB::transaction(function () use ($productModel, $attributes, $request): Product {
                /** @var Product $productModel */
                $productModel = Product::query()
                    ->whereKey($productModel->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $this->assertCanApplyPriceChange($productModel, $attributes);

                $productModel->update($attributes);

                // Update billing cycles if provided
                if ($request->has('billing_cycles')) {
                    $this->billingCycleService->syncBillingCycles($productModel, $request->input('billing_cycles'));
                }

                return $productModel;
            }, 5);

            $this->flushStorefrontCache($productModel->category_uuid);
        } catch (DisplayException $exception) {
            throw $exception;
        } catch (\Exception $ex) {
            throw new \Exception('Failed to update a product: ' . $ex->getMessage());
        }

        Activity::event('admin:billing:products:update')
            ->property('product', $productModel)
            ->property('new_data', $request->all())
            ->description('A billing product has been updated')
            ->log();

        return $this->returnNoContent();
    }

    private function assertCanApplyPriceChange(Product $product, array $attributes): void
    {
        $willBecomeFree = !$product->isFree()
            && array_key_exists('price', $attributes)
            && (float) $attributes['price'] === 0.0;
        if (!$willBecomeFree) {
            return;
        }

        $hasReferencedServers = Server::query()
            ->where('billing_product_id', $product->id)
            ->exists();
        $hasActiveNewServerOrders = Order::query()
            ->where('product_id', $product->id)
            ->where('type', Order::TYPE_NEW)
            ->whereIn('status', [
                Order::STATUS_PENDING,
                Order::STATUS_FULFILLING,
                Order::STATUS_PAYMENT_REVIEW,
            ])
            ->exists();
        if ($hasReferencedServers || $hasActiveNewServerOrders) {
            throw new DisplayException('This product cannot be made free while servers or active new-server orders still use it. Move the servers and reconcile the orders first.');
        }
    }

    /**
     * View an existing product.
     */
    public function view(GetBillingProductRequest $request, string $category, string $product): array
    {
        $productModel = Product::findOrFail((int) $product);

        return $this->fractal->item($productModel)
            ->transformWith(ProductTransformer::class)
            ->toArray();
    }

    /**
     * Delete a product.
     */
    public function delete(DeleteBillingProductRequest $request, string $category, string $product): Response
    {
        $productModel = Product::findOrFail((int) $product);
        $categoryUuid = $productModel->category_uuid;
        $productModel->delete();

        $this->flushStorefrontCache($categoryUuid);

        Activity::event('admin:billing:products:delete')
            ->property('product', $productModel)
            ->description('A billing product has been deleted')
            ->log();

        return $this->returnNoContent();
    }
}
