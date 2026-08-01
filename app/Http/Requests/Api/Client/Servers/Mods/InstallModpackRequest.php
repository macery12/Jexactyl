<?php

namespace Everest\Http\Requests\Api\Client\Servers\Mods;

use Everest\Models\Server;
use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class InstallModpackRequest extends ClientApiRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }

    public function authorize(): bool
    {
        $user = $this->user();
        $server = $this->route()?->parameter('server');
        if (
            !$server instanceof Server
            || !$user->can(Permission::ACTION_FILE_CREATE, $server)
            || !$user->can(Permission::ACTION_FILE_UPDATE, $server)
        ) {
            return false;
        }

        // Wiping the server directory before extraction is destructive, so it
        // additionally requires file.delete.
        return !$this->boolean('wipe_server')
            || $user->can(Permission::ACTION_FILE_DELETE, $server);
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
