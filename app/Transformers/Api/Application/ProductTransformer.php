<?php

namespace Everest\Transformers\Api\Application;

use Everest\Models\Billing\Product;
use Everest\Transformers\Api\Transformer;

class ProductTransformer extends Transformer
{
    /**
     * List of resources that can be included.
     */
    protected array $availableIncludes = [
        'category',
    ];

    /**
     * {@inheritdoc}
     */
    public function getResourceName(): string
    {
        return Product::RESOURCE_NAME;
    }

    /**
     * Transform this model into a representation that can be consumed by a client.
     */
    public function transform(Product $model): array
    {
        return [
            'id' => $model->id,
            'uuid' => $model->uuid,
            'category_uuid' => $model->category_uuid,
            'name' => $model->name,
            'icon' => $model->icon,
            'price' => $model->price,
            'description' => $model->description,
            // Legacy rows predate visibility being written, and NULL there means
            // "never configured" — treat those as visible so existing storefronts
            // don't silently empty out.
            'visible' => $model->visible === null ? true : (bool) $model->visible,
            'limits' => [
                'cpu' => $model->cpu_limit,
                'memory' => $model->memory_limit,
                'disk' => $model->disk_limit,
                'backup' => $model->backup_limit,
                'database' => $model->database_limit,
                'allocation' => $model->allocation_limit,
                'subdomain' => $model->subdomain_limit,
            ],
            'created_at' => $model->created_at->toIso8601String(),
            'updated_at' => $model->updated_at->toIso8601String() ? $model->updated_at->toIso8601String() : null,
        ];
    }

    /**
     * Include the category relationship for this product.
     */
    public function includeCategory(Product $product): \League\Fractal\Resource\Item|\League\Fractal\Resource\NullResource
    {
        if (!$product->category) {
            return $this->null();
        }

        return $this->item($product->category, new CategoryTransformer());
    }
}
