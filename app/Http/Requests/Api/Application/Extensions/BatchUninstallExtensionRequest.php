<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class BatchUninstallExtensionRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'extension_ids'   => 'required|array|min:1|max:50',
            'extension_ids.*' => 'required|string|max:191',
            // Opt-in, per-extension audited data drop. Each entry names an
            // extension in extension_ids and echoes its id back as a typed
            // confirmation, matching the single-uninstall rigor. Extensions
            // absent from this list preserve their data.
            'drop_data'           => 'sometimes|array',
            'drop_data.*.id'      => 'required|string|max:191',
            'drop_data.*.confirm' => 'required|string',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EXTENSIONS_DELETE;
    }
}
