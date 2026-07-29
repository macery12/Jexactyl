<?php

namespace Everest\Http\Requests\Api\Application\Api;

use IPTools\Range;
use Everest\Models\AdminRole;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
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
        if ($this->filled('admin_role_id') && !$this->filled('access_profile_id')) {
            $this->merge(['access_profile_id' => $this->input('admin_role_id')]);
        }

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
            'access_profile_id' => ['required_without:permissions', 'integer', 'exists:admin_roles,id'],
            'admin_role_id' => ['nullable', 'integer', 'exists:admin_roles,id'],
            'permissions' => ['required_without:access_profile_id', 'array:' . implode(',', $resources)],
            'allowed_ips' => ['nullable', 'array', 'max:50'],
            'allowed_ips.*' => ['string'],
            'expires_at' => ['nullable', 'date', 'after:now'],
        ];

        foreach ($resources as $resource) {
            $rules['permissions.' . $resource] = [
                'required_with:permissions',
                'string',
                Rule::in(['none', 'read', 'write']),
            ];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (
                $this->filled('access_profile_id')
                && $this->filled('admin_role_id')
                && (int) $this->input('access_profile_id') !== (int) $this->input('admin_role_id')
            ) {
                $validator->errors()->add(
                    'access_profile_id',
                    'The access_profile_id and admin_role_id fields must identify the same profile.'
                );
            }

            if ($this->filled('access_profile_id') && $this->has('permissions')) {
                $validator->errors()->add(
                    'permissions',
                    'Legacy resource permissions cannot be combined with an access profile.'
                );
            }

            $ips = $this->input('allowed_ips');
            if (!is_array($ips)) {
                return;
            }

            foreach ($ips as $index => $ip) {
                $valid = false;
                try {
                    $valid = Range::parse($ip)->valid();
                } catch (\Exception $exception) {
                    if ($exception->getMessage() !== 'Invalid IP address format') {
                        throw $exception;
                    }
                } finally {
                    $validator->errors()->addIf(
                        !$valid,
                        "allowed_ips.{$index}",
                        '"' . $ip . '" is not a valid IP address or CIDR range.'
                    );
                }
            }
        });
    }

    /**
     * Return validated permission names as the database bit masks expected by
     * KeyCreationService.
     *
     * @return array<string, int>
     */
    public function keyPermissions(): array
    {
        if (!$this->has('permissions')) {
            return [];
        }

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

    public function accessProfileId(): ?int
    {
        $id = $this->validated('access_profile_id');

        return $id === null ? null : (int) $id;
    }

    public function permission(): string
    {
        return AdminRole::API_CREATE;
    }
}
