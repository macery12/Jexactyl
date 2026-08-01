<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class DeleteExtensionRepositoryRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::EXTENSIONS_REPOSITORIES;
    }
}
