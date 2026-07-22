<?php

namespace Everest\Http\Requests\Api\Application\Email;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class RevertEmailTemplateRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::EMAIL_UPDATE;
    }
}
