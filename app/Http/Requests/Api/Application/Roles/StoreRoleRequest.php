<?php

namespace Everest\Http\Requests\Api\Application\Roles;

use Everest\Models\AdminRole;
use Illuminate\Validation\Rule;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreRoleRequest extends ApplicationApiRequest
{
    public function rules(?array $rules = null): array
    {
        $rules = $rules ?? AdminRole::getRules();
        $rules['permissions'] = ['sometimes', 'array'];
        $rules['permissions.*'] = [
            'string',
            'distinct',
            Rule::in(app(AdminCapabilityRegistry::class)->all()),
        ];

        return $rules;
    }

    protected function prepareForValidation(): void
    {
        parent::prepareForValidation();

        if (is_array($this->input('permissions'))) {
            $this->merge([
                'permissions' => app(AdminCapabilityRegistry::class)
                    ->normalizeMany($this->input('permissions')),
            ]);
        }
    }

    public function permission(): string
    {
        return AdminRole::ROLES_CREATE;
    }
}
