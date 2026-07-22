<?php

namespace Everest\Http\Requests\Api\Application\Email;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateEmailTemplateSourceRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::EMAIL_UPDATE;
    }

    public function rules(): array
    {
        return [
            'content' => 'required|string',
        ];
    }
}
