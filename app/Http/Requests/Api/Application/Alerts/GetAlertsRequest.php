<?php

namespace Everest\Http\Requests\Api\Application\Alerts;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetAlertsRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [];
    }

    public function permission(): string
    {
        return AdminRole::ALERTS_READ;
    }
}
