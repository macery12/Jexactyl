<?php

namespace Everest\Transformers\Api\Pub;

use Everest\Models\Billing\Product;
use Everest\Transformers\Api\Transformer;

/**
 * Slim, public-safe representation of a storefront product. Exposes only what a
 * storefront card needs — name, pricing and the resources it grants. Never
 * exposes egg ids, nest mapping, allowed-egg lists or any internal flags.
 */
class PublicProductTransformer extends Transformer
{
    public function getResourceName(): string
    {
        return Product::RESOURCE_NAME;
    }

    public function transform(Product $model): array
    {
        return [
            'id' => $model->id,
            'name' => $model->name,
            'icon' => $model->icon,
            'price' => $model->price,
            'base_price' => $model->base_price,
            'description' => $model->description,
            'limits' => [
                'cpu' => $model->cpu_limit,
                'memory' => $model->memory_limit,
                'disk' => $model->disk_limit,
                'backup' => $model->backup_limit,
                'database' => $model->database_limit,
                'allocation' => $model->allocation_limit,
                'subdomain' => $model->subdomain_limit,
            ],
        ];
    }
}
