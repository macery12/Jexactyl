<?php

namespace Everest\Http\Requests\Api\Application\Roles;

use Everest\Models\AdminRole;

class UpdateRoleRequest extends StoreRoleRequest
{
    public function rules(?array $rules = null): array
    {
        $rules = parent::rules(
            $rules ?? AdminRole::getRulesForUpdate($this->route()->parameter('role'))
        );

        foreach ($rules as $field => $fieldRules) {
            if ($field === 'permissions.*') {
                continue;
            }

            $fieldRules = is_array($fieldRules) ? $fieldRules : explode('|', $fieldRules);
            $rules[$field] = array_values(array_unique([
                'sometimes',
                ...array_filter($fieldRules, static fn (mixed $rule): bool => $rule !== 'required'),
            ]));
        }

        return $rules;
    }

    public function permission(): string
    {
        return AdminRole::ROLES_UPDATE;
    }
}
