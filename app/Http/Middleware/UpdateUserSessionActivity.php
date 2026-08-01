<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Everest\Models\UserSession;
use Illuminate\Support\Facades\Log;
use Everest\Services\Auth\UserSessionService;
use Symfony\Component\HttpFoundation\Response;

class UpdateUserSessionActivity
{
    /**
     * Update the last activity timestamp for the authenticated user's session.
     *
     * Tracking is fail-closed: an authenticated request whose session has no
     * matching (and un-revoked) user_session row is rejected rather than
     * silently trusted. Every login records a row synchronously
     * (UserSessionService::recordLogin), so the only sessions without one are
     * revoked sessions or sessions that predate session tracking — neither of
     * which should be allowed to continue. Previously this branch retained the
     * request and let updateActivity() recreate a fresh, non-revoked row, which
     * meant a revoked or untracked session could survive a password reset.
     *
     * The one legitimate exception is a session Laravel just rebuilt from a
     * "remember me" cookie: SessionGuard regenerates the session id on that path,
     * so the row written at login no longer matches and the user was being signed
     * out every time their session lapsed. viaRemember() identifies exactly that
     * case, and recordRememberedSession() re-establishes tracking while still
     * refusing devices whose session was revoked.
     */
    public function handle(Request $request, \Closure $next)
    {
        $user = $request->user();
        if ($user && $request->hasSession()) {
            $sessionId = $request->session()->getId();

            $sessionRecord = UserSession::query()
                ->where('user_id', $user->id)
                ->where('session_id', $sessionId)
                ->first();

            if (!$sessionRecord && $this->authenticatedViaRemember()) {
                $sessionRecord = app(UserSessionService::class)->recordRememberedSession($user, $sessionId);

                if ($sessionRecord) {
                    Log::info('UpdateUserSessionActivity: re-tracked session restored from remember-me cookie', [
                        'user_id' => $user->id,
                        'session_db_id' => $sessionRecord->id,
                    ]);
                }
            }

            if (!$sessionRecord) {
                Log::info('UpdateUserSessionActivity: rejected session with no tracking record', [
                    'user_id' => $user->id,
                ]);

                return $this->rejectSession($request);
            }

            if ($sessionRecord->revoked_at) {
                Log::info('UpdateUserSessionActivity: blocked revoked session', [
                    'user_id' => $user->id,
                    'session_db_id' => $sessionRecord->id,
                ]);

                return $this->rejectSession($request);
            }
        }

        $response = $next($request);

        $user = $request->user();
        if ($user && $request->hasSession()) {
            $sessionId = $request->session()->getId();
            /** @var UserSessionService $service */
            $service = app(UserSessionService::class);
            $service->updateActivity($request->user(), $sessionId);
        }

        return $response;
    }

    /**
     * Whether the guard authenticated this request from a "remember me" cookie
     * rather than an existing session payload.
     *
     * viaRemember() is specific to SessionGuard, so it is guarded — a token guard
     * has no recaller and must keep the strict behaviour. Sanctum's stateful path
     * delegates to the same web guard, so this reads correctly for /api as well.
     */
    private function authenticatedViaRemember(): bool
    {
        $guard = auth()->guard();

        return method_exists($guard, 'viaRemember') && $guard->viaRemember();
    }

    /**
     * Tear down the current session and return the appropriate unauthenticated
     * response for the request type.
     */
    private function rejectSession(Request $request): Response
    {
        $guard = auth()->guard();
        if (method_exists($guard, 'logout')) {
            $guard->logout();
        }
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        if ($request->expectsJson()) {
            return response()->json([
                'errors' => [[
                    'code' => 'SESSION_REVOKED',
                    'detail' => 'This session has been revoked.',
                ]],
            ], 401);
        }

        return redirect()->guest(route('auth.login'));
    }
}
