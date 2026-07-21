<?php

namespace Everest\Http\Requests\Api\Client\Servers\Mods;

use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class InstallModpackRequest extends ClientApiRequest
{
    public function permission(): string
    {
        // Wiping the server directory before extraction is destructive, so it must
        // require file.delete — not just file.create — otherwise a subuser with only
        // create permission could wipe the whole data directory.
        return $this->boolean('wipe_server')
            ? Permission::ACTION_FILE_DELETE
            : Permission::ACTION_FILE_CREATE;
    }

    public function rules(): array
    {
        return [
            'project_id'     => 'required|integer',
            'file_id'        => 'required|integer',
            'modpack_name'   => 'nullable|string|max:255',
            'wipe_server'    => 'boolean',
            'install_loader' => 'boolean',
        ];
    }
}
