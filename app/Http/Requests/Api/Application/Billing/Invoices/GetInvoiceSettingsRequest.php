<?php

namespace Everest\Http\Requests\Api\Application\Billing\Invoices;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetInvoiceSettingsRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::BILLING_READ;
    }
}
