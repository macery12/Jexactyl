<?php

namespace Everest\Http\Requests\Api\Application\Eggs\Variables;

use Everest\Models\AdminRole;
use Everest\Models\EggVariable;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateEggVariablesRequest extends ApplicationApiRequest
{
    public function rules(?array $rules = null): array
    {
        return [
            '*' => 'array',
            '*.id' => 'required|integer',
            '*.name' => 'string|min:1|max:191',
            '*.description' => 'string|nullable',
            '*.env_variable' => 'regex:/^[\w]{1,191}$/|notIn:' . EggVariable::RESERVED_ENV_NAMES,
            '*.default_value' => 'present',
            '*.user_viewable' => 'boolean',
            '*.user_editable' => 'boolean',
            '*.rules' => 'string',
            '*.field_type' => 'sometimes|string|in:text,password,number,boolean',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EGGS_UPDATE;
    }
}
