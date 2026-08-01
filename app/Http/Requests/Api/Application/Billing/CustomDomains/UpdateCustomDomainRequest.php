<?php

namespace Everest\Http\Requests\Api\Application\Billing\CustomDomains;

use Everest\Models\AdminRole;

class UpdateCustomDomainRequest extends StoreCustomDomainRequest
{
    public function permission(): string
    {
        return AdminRole::CUSTOM_DOMAINS_UPDATE;
    }
}
