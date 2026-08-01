<?php

namespace Everest\Http\Requests\Api\Application\Alerts;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class SearchAlertUsersRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::ALERTS_UPDATE;
    }
}
