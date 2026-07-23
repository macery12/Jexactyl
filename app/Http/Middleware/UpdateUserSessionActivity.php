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

            if (!$sessionRecord) {
                Log::info('UpdateUserSessionActivity: rejected session with no tracking record', [
                    'user_id' => $user->id,
                    'session_id' => $sessionId,
                ]);

                return $this->rejectSession($request);
            }

            if ($sessionRecord->revoked_at) {
                Log::info('UpdateUserSessionActivity: blocked revoked session', [
                    'user_id' => $user->id,
                    'session_id' => $sessionId,
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
