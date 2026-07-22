<?php

namespace Everest\Http\Requests\Api\Application\Eggs;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class StoreEggRequest extends ApplicationApiRequest
{
    public function rules(?array $rules = null): array
    {
        return [
            'nest_id' => 'required|bail|numeric|exists:nests,id',
            'name' => 'required|string|max:191',
            'description' => 'sometimes|string|nullable',
            'features' => 'sometimes|array',
            'features.*' => 'string',
            'docker_images' => 'required|array|min:1',
            'docker_images.*' => 'required|string',
            'file_denylist' => 'sometimes|array|nullable',
            'file_denylist.*' => 'sometimes|string',
            'config_files' => 'required|nullable|json',
            'config_startup' => 'required|nullable|json',
            'config_stop' => 'required|nullable|string|max:191',
            'config_from' => 'sometimes|nullable|numeric|exists:eggs,id',
            'startup' => 'required|string',
            'force_outgoing_ip' => 'sometimes|boolean',
            'update_url' => 'sometimes|nullable|string|max:191',
            'script_container' => 'sometimes|string',
            'script_entry' => 'sometimes|string',
            'script_install' => 'sometimes|string',
            'copy_script_from' => 'sometimes|nullable|numeric|exists:eggs,id',
            'script_is_privileged' => 'sometimes|boolean',
        ];
    }

    public function permission(): string
    {
        return AdminRole::EGGS_CREATE;
    }
}
