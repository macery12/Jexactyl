<?php

namespace Everest\Transformers\Api\Pub;

use Everest\Models\Billing\Category;
use Everest\Transformers\Api\Transformer;

/**
 * Slim, public-safe representation of a storefront category. Deliberately omits
 * internal fields (nest/egg ids, allowed eggs, plan-change flags) that the
 * authenticated client transformer exposes — guests only need to browse.
 */
class PublicCategoryTransformer extends Transformer
{
    public function getResourceName(): string
    {
        return Category::RESOURCE_NAME;
    }

    public function transform(Category $model): array
    {
        return [
            'id' => $model->id,
            'name' => $model->name,
            'icon' => $model->icon,
            'description' => $model->description,
        ];
    }
}
