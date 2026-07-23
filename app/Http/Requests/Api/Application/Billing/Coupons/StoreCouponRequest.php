<?php

namespace Everest\Http\Requests\Api\Application\Billing\Coupons;

use Everest\Models\AdminRole;
use Everest\Models\Billing\Coupon;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreCouponRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::BILLING_UPDATE;
    }

    public function rules(): array
    {
        $rules = Coupon::$validationRules;

        return [
            'code' => $rules['code'],
            'type' => $rules['type'],
            'value' => $rules['value'],
            'max_uses' => $rules['max_uses'],
            'max_uses_per_user' => $rules['max_uses_per_user'],
            'min_order_total' => $rules['min_order_total'],
            'expires_at' => $rules['expires_at'],
            'is_active' => $rules['is_active'],
            'allowed_for' => $rules['allowed_for'],
        ];
    }
}
