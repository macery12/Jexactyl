<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreExtensionRepositoryRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|max:191',
            'manifest_url' => 'required|string|max:2048',
            'homepage_url' => 'nullable|string|max:2048',
            'enabled' => 'sometimes|boolean',
            'acknowledge_risk' => 'required|accepted',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EXTENSIONS_REPOSITORIES;
    }
}
