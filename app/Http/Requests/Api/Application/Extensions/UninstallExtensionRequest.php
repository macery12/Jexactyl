<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UninstallExtensionRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'drop_data' => 'sometimes|boolean',
            // Destructive data drops require the caller to echo the extension
            // id back, mirroring the CLI's typed confirmation.
            'confirm' => 'required_if:drop_data,true|string',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EXTENSIONS_DELETE;
    }
}