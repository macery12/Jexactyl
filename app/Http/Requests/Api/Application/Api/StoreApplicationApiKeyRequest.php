<?php

namespace Everest\Http\Requests\Api\Application\Api;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreApplicationApiKeyRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'memo' => 'required|string|min:3|max:191',
        ];
    }

    public function permission(): string
    {
        return AdminRole::API_CREATE;
    }
}
