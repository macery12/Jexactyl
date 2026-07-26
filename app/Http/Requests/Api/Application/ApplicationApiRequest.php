<?php

namespace Everest\Http\Requests\Api\Application;

use Everest\Models\User;
use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\ApiRequest;

abstract class ApplicationApiRequest extends ApiRequest
{
    /**
     * Authorize users based on their Admin Role (if exists)
     * to allow admins to visit specific permissable endpoints.
     */
    public function authorize(): bool
    {
        $user = ($this->getUserResolver())();
        if (!$user instanceof User || !$user->isActive() || !method_exists($this, 'permission')) {
            return false;
        }

        if ($user->root_admin) {
            return true;
        }

        // ClientApiRequest historically inherits this class but overrides
        // authorize() and does not always declare an admin-role permission.
        // Keep this base class concrete while failing closed on the
        // Application API authorization path.
        if (!$user->admin_role_id) {
            return false;
        }

        $role = AdminRole::query()->find($user->admin_role_id);

        return $role !== null
            && in_array($this->permission(), $role->permissions ?? [], true);
    }

    /**
     * Return only the fields that we are interested in from the request.
     * This will include empty fields as a null value.
     */
    public function normalize(?array $only = null): array
    {
        return $this->only($only ?? array_keys($this->rules()));
    }
}
