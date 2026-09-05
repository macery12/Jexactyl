<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Illuminate\Http\Request;
use Laravel\Sanctum\TransientToken;
use Illuminate\Support\Facades\Auth;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\Facades\Request as RequestFacade;

/**
 * Gives a queue worker the one thing `ToolExecutor` cannot do without: a parent
 * request to derive sub-requests from. `buildSubRequest()` takes the scheme,
 * host and client address from it and copies its user resolver, none of which
 * exists in a worker.
 *
 * Safety comes from what it does *not* invent. No session, so
 * `UpdateUserSessionActivity` skips itself and a background turn can neither
 * create nor destroy one. No cookies, so nothing is decrypted or re-encrypted.
 * The identity carries the same credential kind as the starting request: a
 * `TransientToken` for a browser session, or the freshly-reloaded `ApiKey` for a
 * token request. That keeps key type/profile/IP middleware and activity
 * attribution authoritative inside every internal sub-request.
 *
 * The guard is primed rather than resolved: a `RequestGuard` returns the user
 * it was given without consulting the request. Skipped priming would 401, so
 * the failure direction is closed.
 */
class WorkerRequestScope
{
    public function __construct(private Application $app)
    {
    }

    /**
     * Run a callable with the authority installed, then put the container back.
     * Restoration is not tidiness: a worker handles unrelated jobs afterwards,
     * and a resolved user left on the guard would run the *next* one as this
     * turn's owner.
     *
     * @template T
     *
     * @param callable(User): T $run
     *
     * @return T
     */
    public function during(TurnAuthority $authority, User $user, callable $run): mixed
    {
        $previousRequest = $this->app->bound('request') ? $this->app->make('request') : null;

        $request = $this->buildRequest($authority, $user);

        $key = $authority->apiKey();
        if ($authority->apiKeyId !== null && $key === null) {
            throw new \RuntimeException('The API key that started this turn is no longer valid.');
        }

        // Never replay the secret. The database model is all Sanctum and the
        // authorization middleware need to preserve the key's restrictions.
        $user->withAccessToken($key ?? new TransientToken());

        try {
            $this->app->instance('request', $request);
            RequestFacade::clearResolvedInstance();

            // Rebinding `request` above re-points the guards at it, but does not
            // populate them. This is what makes `auth:sanctum` succeed inside
            // the sub-request.
            Auth::guard('sanctum')->setUser($user);
            Auth::shouldUse('sanctum');

            return $run($user);
        } finally {
            Auth::forgetGuards();

            if ($previousRequest !== null) {
                $this->app->instance('request', $previousRequest);
            } else {
                $this->app->forgetInstance('request');
            }

            RequestFacade::clearResolvedInstance();
        }
    }

    /**
     * The synthetic parent request. The URI matters more than it looks:
     * `ToolExecutor` builds absolute sub-request URLs and signed node download
     * URLs from this host, and a wrong one produces signatures the daemon
     * rejects — so the origin is captured from the request that started the turn
     * rather than assumed from config.
     */
    private function buildRequest(TurnAuthority $authority, User $user): Request
    {
        $request = Request::create(
            uri: $authority->origin,
            method: 'GET',
            server: array_filter(['REMOTE_ADDR' => $authority->ip]),
        );

        $request->headers->set('Accept', 'application/json');
        $request->headers->set('X-Requested-With', 'XMLHttpRequest');

        // Copied by `ToolExecutor::buildSubRequest()` onto every tool call.
        $request->setUserResolver(fn () => $user);

        return $request;
    }
}
