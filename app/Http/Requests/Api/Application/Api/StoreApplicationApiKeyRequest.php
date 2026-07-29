<?php

namespace Everest\Http\Requests\Api\Application\Api;

use Everest\Models\AdminRole;
use Illuminate\Validation\Rule;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreApplicationApiKeyRequest extends ApplicationApiRequest
{
    /**
     * Preserve the historical create contract while exposing readable grant
     * names to new clients. The old UI used 2 to mean read+write, so both 2 and
     * 3 normalize to the canonical "write" grant.
     */
    protected function prepareForValidation(): void
    {
        $permissions = $this->input('permissions');
        if (!is_array($permissions)) {
            return;
        }

        $resources = AdminAcl::getResourceList();
        $legacyKeys = array_map(static fn (string $resource): string => AdminAcl::COLUMN_IDENTIFIER . $resource, $resources);
        if (array_diff(array_keys($permissions), $legacyKeys) !== [] || count($permissions) !== count($legacyKeys)) {
            return;
        }

        $grants = [
            0 => 'none',
            1 => 'read',
            2 => 'write',
            3 => 'write',
        ];
        $normalized = [];
        foreach ($resources as $resource) {
            $value = $permissions[AdminAcl::COLUMN_IDENTIFIER . $resource] ?? null;
            if (!in_array($value, [0, 1, 2, 3, '0', '1', '2', '3'], true)) {
                return;
            }

            $normalized[$resource] = $grants[(int) $value];
        }

        $this->merge(['permissions' => $normalized]);
    }

    public function rules(): array
    {
        $resources = AdminAcl::getResourceList();
        $rules = [
            'memo' => 'required|string|min:3|max:191',
            'permissions' => ['required', 'array:' . implode(',', $resources)],
        ];

        foreach ($resources as $resource) {
            $rules['permissions.' . $resource] = ['required', 'string', Rule::in(['none', 'read', 'write'])];
        }

        return $rules;
    }

    /**
     * Return validated permission names as the database bit masks expected by
     * KeyCreationService.
     *
     * @return array<string, int>
     */
    public function keyPermissions(): array
    {
        $grants = [
            'none' => AdminAcl::NONE,
            'read' => AdminAcl::READ,
            'write' => AdminAcl::READ | AdminAcl::WRITE,
        ];
        $permissions = [];

        foreach (AdminAcl::getResourceList() as $resource) {
            $permissions[AdminAcl::COLUMN_IDENTIFIER . $resource] = $grants[$this->validated('permissions.' . $resource)];
        }

        return $permissions;
    }

    public function permission(): string
    {
        return AdminRole::API_CREATE;
    }
}
