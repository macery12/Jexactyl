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
 * request to derive sub-requests from.
 *
 * Every agent tool call is dispatched through the panel's real HTTP kernel, and
 * that design — the reason there is no second authorization path to get wrong —
 * assumes a request is already in flight. `ToolExecutor::buildSubRequest()`
 * takes the scheme and host from it, the client address from it, and, most
 * importantly, copies its user resolver. In a worker none of that exists, so it
 * is built here instead, explicitly, in one readable place.
 *
 * What makes this safe is what it does *not* invent. There is no session, so
 * `UpdateUserSessionActivity` skips itself and no session can be created,
 * regenerated or destroyed by a background turn. There are no cookies, so
 * nothing is decrypted or re-encrypted. The identity carries a
 * `TransientToken`, which is precisely what a browser-session request carries —
 * so `RequireClientApiKey`, `RequireTwoFactorAuthentication` and
 * `AuthenticateIPAccess` all reach exactly the conclusion they reach for the UI
 * today, rather than a special case written for the agent.
 *
 * The guard is primed rather than resolved. `auth:sanctum` asks the guard for a
 * user, and a `RequestGuard` returns the one it has been given without
 * consulting the request at all — the same cache the request-bound path already
 * relies on. If priming were ever skipped the middleware would 401. The failure
 * direction is closed.
 */
class WorkerRequestScope
{
    public function __construct(private Application $app)
    {
    }

    /**
     * Run a callable with the authority installed, then put the container back.
     *
     * Restoration is not tidiness. A queue worker is a long-lived process that
     * handles unrelated jobs afterwards; leaving a resolved user on the guard
     * would make the *next* job run as this turn's owner.
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

        // Sanctum marks a stateful (browser) request by handing the user a
        // transient token. Doing the same here is the entire "session
        // equivalent" decision, expressed where the middleware will read it:
        // every token-shaped check downstream sees what it sees for the UI.
        $user->withAccessToken(new TransientToken());

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
     * The synthetic parent request.
     *
     * The URI matters more than it looks: `ToolExecutor` builds absolute
     * sub-request URLs from this host, and signed node URLs for file downloads
     * are generated against it. A worker with the wrong host produces
     * signatures the daemon rejects, so the origin is captured from the request
     * that started the turn rather than assumed from config.
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
