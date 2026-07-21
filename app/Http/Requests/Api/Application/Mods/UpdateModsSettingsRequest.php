<?php

namespace Everest\Http\Requests\Api\Application\Mods;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateModsSettingsRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'enabled'                  => 'nullable|bool',
            'default_source'           => 'nullable|string|in:modrinth,spigot,spiget',
            'spiget_enabled'           => 'nullable|bool',
            'curseforge_enabled'       => 'nullable|bool',
            'curseforge_api_key'       => 'nullable|string|max:512',
            'allow_external_downloads'  => 'nullable|bool',
            'curseforge_cdn_fallback'   => 'nullable|bool',
            'download_max_concurrent'  => 'nullable|integer|min:1|max:10',
            'download_max_per_minute'  => 'nullable|integer|min:1|max:60',
            'download_max_queue_size'  => 'nullable|integer|min:1|max:100',
            'max_mod_size'             => 'nullable|integer|min:1048576|max:524288000', // 1MB–500MB in bytes
            'max_plugin_size'          => 'nullable|integer|min:1048576|max:524288000',
        ];
    }

    public function permission(): string
    {
        return AdminRole::MODS_UPDATE;
    }
}
