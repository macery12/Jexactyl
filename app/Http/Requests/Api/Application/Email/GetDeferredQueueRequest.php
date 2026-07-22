<?php

namespace Everest\Http\Requests\Api\Application\Email;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetDeferredQueueRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'status' => 'nullable|in:due,pending',
            'per_page' => 'nullable|integer|min:1|max:100',
            'page' => 'nullable|integer|min:1',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EMAIL_READ;
    }
}
