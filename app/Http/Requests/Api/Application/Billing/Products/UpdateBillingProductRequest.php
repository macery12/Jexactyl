<?php

namespace Everest\Http\Requests\Api\Application\Billing\Products;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateBillingProductRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::BILLING_PRODUCTS_UPDATE;
    }

    public function rules(): array
    {
        return [
            'name'             => 'sometimes|string|min:1|max:255',
            'description'      => 'nullable|string|max:1000',
            'icon'             => 'nullable|string|max:100',
            'price'            => 'sometimes|numeric|min:0',
            'visible'          => 'sometimes|boolean',
            'category_uuid'    => 'sometimes|string|exists:categories,uuid',
            'cpu_limit'        => 'sometimes|integer|min:0',
            'memory_limit'     => 'sometimes|integer|min:0',
            'disk_limit'       => 'sometimes|integer|min:0',
            'backup_limit'     => 'sometimes|integer|min:0',
            'database_limit'   => 'sometimes|integer|min:0',
            'allocation_limit' => 'sometimes|integer|min:0',
            'subdomain_limit'  => 'nullable|integer|min:0',
        ];
    }
}
