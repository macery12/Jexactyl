<?php

namespace Everest\Http\Requests\Api\Application\Billing\Coupons;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateCouponRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::BILLING_UPDATE;
    }

    public function rules(): array
    {
        /** @var \Everest\Models\Billing\Coupon $coupon */
        $coupon = $this->route()->parameter('coupon');
        $couponId = $coupon->id;

        return [
            'code' => 'sometimes|required|string|max:50|unique:coupons,code,' . $couponId,
            'type' => 'sometimes|required|in:percentage,fixed',
            'value' => 'sometimes|required|numeric|min:0',
            'max_uses' => 'nullable|integer|min:1',
            'max_uses_per_user' => 'nullable|integer|min:1',
            'min_order_total' => 'nullable|numeric|min:0',
            'expires_at' => 'nullable|date',
            'is_active' => 'sometimes|boolean',
            'allowed_for' => 'nullable|in:both,purchases,renewals',
        ];
    }
}
