<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateExtensionRepositoryRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'name' => 'sometimes|string|max:191',
            'manifest_url' => 'sometimes|string|max:2048',
            'homepage_url' => 'nullable|string|max:2048',
            'enabled' => 'sometimes|boolean',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EXTENSIONS_REPOSITORIES;
    }
}
