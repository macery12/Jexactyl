<?php

namespace Everest\Policies;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Permission;
use Everest\Services\AI\Agent\AssistSession;

class ServerPolicy
{
    /**
     * Checks if the user has the given permission on/for the server.
     */
    protected function checkPermission(User $user, Server $server, string $permission): bool
    {
        $subuser = $server->subusers->where('user_id', $user->id)->first();
        if (!$subuser || empty($permission)) {
            return false;
        }

        $permissions = Permission::expandPermissions($subuser->permissions ?? []);

        return in_array($permission, $permissions, true);
    }

    /**
     * Runs before any of the functions are called. Used to determine if user is root admin, if so, ignore permissions.
     */
    public function before(User $user, string $ability, Server $server): bool
    {
        if ($user->isOwner() || $server->owner_id === $user->id) {
            return true;
        }

        // A delegated administrator running an approved AI assist session on
        // this server, for the abilities that session was granted and no others.
        // Open only for the duration of one dispatched tool call — outside it
        // this returns false and the same administrator is refused as before.
        if (app(AssistSession::class)->permits($user, $server, $ability)) {
            return true;
        }

        return $this->checkPermission($user, $server, $ability);
    }

    /**
     * This is a horrendous hack to avoid Laravel's "smart" behavior that does
     * not call the before() function if there isn't a function matching the
     * policy permission.
     */
    public function __call(string $name, mixed $arguments)
    {
        // do nothing
    }
}
