<?php

namespace Everest\Http\Middleware\Api\Application;

use Everest\Models\ApiKey;
use Illuminate\Http\Request;
use Laravel\Sanctum\TransientToken;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

class AuthenticateApplicationUser
{
    public function __construct(private ApplicationApiAccessProfileService $profiles)
    {
    }

    /**
     * Authenticate that the currently authenticated user is an administrator
     * and should be allowed to proceed through the application API.
     */
    public function handle(Request $request, \Closure $next): mixed
    {
        /** @var \Everest\Models\User|null $user */
        $user = $request->user();
        if (!$user || !$user->isActive()) {
            throw new AccessDeniedHttpException('This account does not have permission to access the API.');
        }

        // The mirror of RequireClientApiKey: a key issued for one API must not authenticate
        // against the other. Session-authenticated requests from the admin UI carry a
        // TransientToken rather than an ApiKey and are unaffected. Orphaned keys
        // (TYPE_NONE) are rejected here as well -- they are documented as unusable and
        // are not rendered anywhere in the UI.
        $token = $request->user()->currentAccessToken();
        if ($token instanceof ApiKey) {
            if ($token->key_type !== ApiKey::TYPE_APPLICATION) {
                throw new AccessDeniedHttpException('You are attempting to use a client API key on an endpoint that requires an application API key.');
            }

            if (!$this->profiles->profileFor($token)) {
                throw new AccessDeniedHttpException('This Application API key has no valid API-eligible access profile.');
            }
        } elseif (
            !$token instanceof TransientToken
            || !$user->adminRole
        ) {
            throw new AccessDeniedHttpException('This account does not have permission to access the API.');
        }

        return $next($request);
    }
}
