<?php

namespace Everest\Http\Requests\Api\Application\Billing\Products;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreBillingProductRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::BILLING_PRODUCTS_CREATE;
    }

    public function rules(): array
    {
        return [
            'name'             => 'required|string|min:1|max:255',
            'description'      => 'nullable|string|max:1000',
            'icon'             => 'nullable|string|max:100',
            'price'            => 'required|numeric|min:0',
            'visible'          => 'sometimes|boolean',
            'category_uuid'    => 'required|string|exists:categories,uuid',
            'cpu_limit'        => 'required|integer|min:0',
            'memory_limit'     => 'required|integer|min:0',
            'disk_limit'       => 'required|integer|min:0',
            'backup_limit'     => 'required|integer|min:0',
            'database_limit'   => 'required|integer|min:0',
            'allocation_limit' => 'required|integer|min:0',
            'subdomain_limit'  => 'nullable|integer|min:0',
        ];
    }
}
