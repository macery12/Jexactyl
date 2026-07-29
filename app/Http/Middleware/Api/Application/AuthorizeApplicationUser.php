<?php

namespace Everest\Http\Middleware\Api\Application;

use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Illuminate\Routing\Route;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Services\Authorization\ApplicationApiPermissionResolver;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class AuthorizeApplicationUser
{
    public function __construct(private ApplicationApiPermissionResolver $permissions)
    {
    }

    /**
     * Enforce delegated-role permissions for every Application API action.
     *
     * Root administrators still require an explicit action declaration; they
     * bypass only the role membership check after the declaration resolves.
     */
    public function handle(Request $request, \Closure $next): mixed
    {
        $route = $request->route();
        if (!$route instanceof Route) {
            throw new AccessDeniedHttpException('This API action has no permission declaration.');
        }

        try {
            $required = $this->permissions->permissionFor($route);
        } catch (\LogicException) {
            throw new AccessDeniedHttpException('This API action has no permission declaration.');
        }

        $user = $request->user();
        if (!$user || !$user->isActive()) {
            throw new AccessDeniedHttpException();
        }

        if ($required !== null && !$user->root_admin) {
            $role = $user->admin_role_id
                ? AdminRole::query()->find($user->admin_role_id)
                : null;

            if (!$role || !in_array($required, $role->permissions ?? [], true)) {
                throw new AccessDeniedHttpException('This account does not have permission to perform this action.');
            }
        }

        $scope = $this->permissions->scopeFor($route, $required);
        if (
            $scope !== null
            && !AdminAcl::keyPermits($user->currentAccessToken(), $scope['resource'], $scope['action'])
        ) {
            throw new AccessDeniedHttpException('This API key does not have permission to perform this action.');
        }

        return $next($request);
    }
}
