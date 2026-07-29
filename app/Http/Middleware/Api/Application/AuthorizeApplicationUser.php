<?php

namespace Everest\Http\Middleware\Api\Application;

use Everest\Models\ApiKey;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\Authorization\ApplicationApiPermissionResolver;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

class AuthorizeApplicationUser
{
    public function __construct(
        private ApplicationApiPermissionResolver $permissions,
        private ApplicationApiAccessProfileService $profiles,
        private AdminAuthorizer $authorizer,
    ) {
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

        $token = $user->currentAccessToken();
        if ($token instanceof ApiKey) {
            if (
                $token->key_type !== ApiKey::TYPE_APPLICATION
                || ($required !== null && !$this->profiles->allows($token, $required))
            ) {
                throw new AccessDeniedHttpException('This API key does not have permission to perform this action.');
            }
        } elseif ($required !== null && !$this->authorizer->hasCapability($user, $required)) {
            throw new AccessDeniedHttpException('This account does not have permission to perform this action.');
        }

        return $next($request);
    }
}
