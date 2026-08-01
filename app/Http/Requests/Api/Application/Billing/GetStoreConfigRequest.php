<?php

namespace Everest\Http\Requests\Api\Application\Billing;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetStoreConfigRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::BILLING_READ;
    }
}
