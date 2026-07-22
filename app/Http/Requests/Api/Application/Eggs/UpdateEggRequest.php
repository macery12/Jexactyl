<?php

namespace Everest\Http\Requests\Api\Application\Eggs;

use Everest\Models\AdminRole;

class UpdateEggRequest extends StoreEggRequest
{
    public function rules(?array $rules = null): array
    {
        return [
            'nest_id' => 'sometimes|numeric|exists:nests,id',
            'name' => 'sometimes|string|max:191',
            'description' => 'sometimes|string|nullable',
            'features' => 'sometimes|array',
            'features.*' => 'string',
            'docker_images' => 'sometimes|array|min:1',
            'docker_images.*' => 'string',
            'file_denylist' => 'sometimes|array|nullable',
            'file_denylist.*' => 'string',
            'config_files' => 'sometimes|nullable|json',
            'config_startup' => 'sometimes|nullable|json',
            'config_stop' => 'sometimes|nullable|string|max:191',
            'config_from' => 'sometimes|nullable|numeric|exists:eggs,id',
            'startup' => 'sometimes|string',
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
        return AdminRole::EGGS_UPDATE;
    }
}
