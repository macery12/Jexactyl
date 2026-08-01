<?php

namespace Everest\Services\Servers;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Permission;

class GetUserPermissionsService
{
    /**
     * Returns the server specific permissions that a user has. This checks
     * if they are an admin or a subuser for the server. If no permissions are
     * found, an empty array is returned.
     */
    public function handle(Server $server, User $user): array
    {
        if ($user->isOwner() || $user->id === $server->owner_id) {
            $permissions = ['*'];

            if ($user->isOwner()) {
                $permissions[] = 'admin.websocket.errors';
                $permissions[] = 'admin.websocket.install';
                $permissions[] = 'admin.websocket.transfer';
            }

            return $permissions;
        }

        /** @var \Everest\Models\Subuser|null $subuserPermissions */
        $subuserPermissions = $server->subusers()->where('user_id', $user->id)->first();

        return $subuserPermissions ? Permission::expandPermissions($subuserPermissions->permissions ?? []) : [];
    }
}
