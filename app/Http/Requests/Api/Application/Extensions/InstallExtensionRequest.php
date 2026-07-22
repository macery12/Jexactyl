<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class InstallExtensionRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'repository_id' => 'required|integer|exists:extension_repositories,id',
            'version' => 'nullable|string|max:191',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EXTENSIONS_INSTALL;
    }
}
