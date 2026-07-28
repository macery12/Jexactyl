<?php

namespace Everest\Http\Requests\Api\Client\Servers\Files;

use Everest\Models\Server;
use Everest\Models\Permission;
use Everest\Contracts\Http\ClientPermissionsRequest;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

/**
 * Base request for daemon file operations that cannot atomically distinguish
 * creating a new path from replacing an existing path.
 *
 * Until the daemon exposes exclusive-create semantics, granting only
 * file.create must never authorize one of these overwrite-capable operations.
 */
abstract class OverwriteCapableFileRequest extends ClientApiRequest implements ClientPermissionsRequest
{
    public function permission(): string
    {
        return Permission::ACTION_FILE_CREATE;
    }

    public function authorize(): bool
    {
        $user = $this->user();
        $server = $this->route()?->parameter('server');

        return $server instanceof Server
            && $user->can(Permission::ACTION_FILE_CREATE, $server)
            && $user->can(Permission::ACTION_FILE_UPDATE, $server);
    }
}
