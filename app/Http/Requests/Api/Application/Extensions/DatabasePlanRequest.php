<?php

namespace Everest\Http\Requests\Api\Application\Extensions;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Read-only preview of the database changes an install/update/uninstall would
 * make. Gated on extensions.read since it only inspects — it never mutates.
 */
class DatabasePlanRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'operation' => 'required|string|in:install,update,uninstall',
            // Install/update need a source to fetch the archive and parse its
            // migrations; uninstall reads local state and needs neither.
            'repository_id' => 'required_if:operation,install,update|integer|exists:extension_repositories,id',
            'version' => 'nullable|string|max:191',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EXTENSIONS_READ;
    }
}
