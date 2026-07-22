<?php

namespace Everest\Transformers\Api\Application;

use Everest\Models\Billing\Coupon;
use Everest\Transformers\Api\Transformer;

class CouponTransformer extends Transformer
{
    public function getResourceName(): string
    {
        return Coupon::RESOURCE_NAME;
    }

    /**
     * Transform this model into a representation that can be consumed by a client.
     */
    public function transform(Coupon $model): array
    {
        return [
            'id' => $model->id,
            'code' => $model->code,
            'type' => $model->type,
            'value' => $model->value,
            'max_uses' => $model->max_uses,
            'max_uses_per_user' => $model->max_uses_per_user,
            'min_order_total' => $model->min_order_total,
            'expires_at' => $model->expires_at?->toIso8601String(),
            'is_active' => $model->is_active,
            'allowed_for' => $model->allowed_for,
            'usage_count' => $model->usage_count,
            'created_at' => $model->created_at->toIso8601String(),
            'updated_at' => $model->updated_at->toIso8601String(),
        ];
    }
}
