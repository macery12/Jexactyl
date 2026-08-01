<?php

namespace Everest\Services\Auth;

use Everest\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\UserSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Everest\Events\Email\NewLoginDetected;
use Illuminate\Support\Facades\Session as SessionFacade;
use Everest\Exceptions\Http\Auth\AccountSuspendedException;
use Everest\Exceptions\Http\Auth\AccountPendingApprovalException;

class UserSessionService
{
    public const DEVICE_COOKIE = 'everest_device_id';

    public function __construct(private Request $request)
    {
    }

    /**
     * Record or update a user session on login and trigger notification if needed.
     */
    public function recordLogin(User $user, string $sessionId, ?string &$deviceId): UserSession
    {
        return DB::transaction(function () use ($user, $sessionId, &$deviceId): UserSession {
            /** @var User $lockedUser */
            $lockedUser = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            if ($lockedUser->isSuspended()) {
                throw new AccountSuspendedException();
            }
            if ($lockedUser->isPending()) {
                throw AccountPendingApprovalException::withConfiguredMessage();
            }

            $deviceId = $deviceId ?: Str::uuid()->toString();
            $fingerprint = $this->fingerprint($deviceId);
            $now = CarbonImmutable::now();
            $existingForFingerprint = UserSession::query()
                ->where('user_id', $lockedUser->id)
                ->where('device_fingerprint', $fingerprint)
                ->orderByDesc('created_at')
                ->first();

            $session = UserSession::query()->updateOrCreate(
                [
                    'user_id' => $lockedUser->id,
                    'device_fingerprint' => $fingerprint,
                ],
                [
                    'session_id' => $sessionId,
                    'device_name' => $this->deviceName(),
                    'user_agent' => $this->userAgent(),
                    'ip_address' => $this->ip(),
                    'location' => $this->location(),
                    'last_activity_at' => $now,
                    'revoked_at' => null,
                ]
            );

            $shouldNotify = $this->shouldNotify($existingForFingerprint);

            if (!$shouldNotify && $existingForFingerprint && $existingForFingerprint->last_notified_at && !$session->last_notified_at) {
                $session->forceFill(['last_notified_at' => $existingForFingerprint->last_notified_at])->save();
            }

            if ($shouldNotify) {
                $session->forceFill(['last_notified_at' => $now])->save();
                // Generate a unique correlation ID per email send to keep delivery logs distinct.
                $correlationId = Str::uuid()->toString();

                event(new NewLoginDetected(
                    $lockedUser,
                    $this->ip(),
                    $this->userAgent(),
                    $correlationId,
                    $now,
                    $this->location()
                ));
            }

            return $session;
        });
    }

    /**
     * Update last activity metadata for current request.
     */
    public function updateActivity(User $user, string $sessionId): void
    {
        // Ensure a row exists for this session (handles cache resets/pruned rows) without sending notifications.
        $session = $this->ensureSessionExists($user, $sessionId);
        if (!$session) {
            return;
        }

        $updated = UserSession::query()
            ->where('user_id', $user->id)
            ->where('session_id', $sessionId)
            ->update([
                'last_activity_at' => CarbonImmutable::now(),
                'ip_address' => $this->ip(),
                'user_agent' => $this->userAgent(),
            ]);

    }

    /**
     * Re-establish tracking for a session Laravel just rebuilt from a valid
     * "remember me" cookie.
     *
     * SessionGuard::updateSession() calls session()->regenerate(true) whenever the
     * recaller logs a user back in, so the new session id never matches the row
     * written at the original login. Without this, the fail-closed check in
     * UpdateUserSessionActivity treats every remembered login as an untracked
     * session and signs the user out — which is what made "remember me" useless
     * and produced the once-a-day forced logouts.
     *
     * Revocation still wins. Revoking now cycles the remember token, so a
     * signed-out device cannot reach this method at all; the fingerprint check
     * below is the second line of defence for cookies issued before that shipped.
     *
     * Returns null when the caller must reject the request.
     */
    public function recordRememberedSession(User $user, string $sessionId): ?UserSession
    {
        // Mirrors recordLogin()'s gate: a suspended or held account must not get a
        // session back just because it still holds a cookie.
        if ($user->isSuspended() || $user->isPending()) {
            return null;
        }

        $fingerprint = $this->fingerprint($this->currentDeviceId());

        return DB::transaction(function () use ($user, $sessionId, $fingerprint): ?UserSession {
            $existing = UserSession::query()
                ->where('user_id', $user->id)
                ->where('device_fingerprint', $fingerprint)
                ->orderByDesc('last_activity_at')
                ->lockForUpdate()
                ->first();

            if (!$existing) {
                // No row for this fingerprint, so nothing proves this device was
                // ever signed in on it. Fail closed and make the user log in again
                // — the same outcome as before this method existed.
                //
                // Creating a row here instead would be friendlier when a signature
                // legitimately moves (a browser update changes the UA, or the /24
                // changes on a new network), but it would also let a device whose
                // session was revoked restore itself whenever its fingerprint no
                // longer matches the revoked row. Rejecting keeps the middleware
                // able to tear down a replayed cookie, and costs one re-login.
                return null;
            }

            if ($existing->revoked_at) {
                return null;
            }

            $now = CarbonImmutable::now();

            // (user_id, session_id) is unique. Nothing should already hold the new
            // id — the middleware only calls this after failing to find it — but
            // clear any stale row so the write cannot fail on the index.
            UserSession::query()
                ->where('user_id', $user->id)
                ->where('session_id', $sessionId)
                ->whereKeyNot($existing->id)
                ->delete();

            $existing->forceFill([
                'session_id' => $sessionId,
                'device_name' => $this->deviceName(),
                'user_agent' => $this->userAgent(),
                'ip_address' => $this->ip(),
                'location' => $this->location(),
                'last_activity_at' => $now,
            ])->save();

            return $existing;
        });
    }

    /**
     * Invalidate every "remember me" cookie belonging to this user.
     *
     * The recaller cookie is checked against a single per-user remember_token, so
     * it cannot be revoked per device — cycling the token is the only way to stop
     * a revoked device walking back in on its cookie. Live sessions are unaffected:
     * they authenticate from the session payload, not the recaller. The blast
     * radius is "other devices lose remember-me", not "other devices are signed
     * out", and SessionGuard::logout() already does exactly this on sign-out.
     */
    private function cycleRememberToken(User $user): void
    {
        $token = Str::random(60);

        // Query-builder update rather than $user->save(): the model validates on
        // save, and this must not be able to fail on unrelated attribute rules.
        User::query()->whereKey($user->id)->update([$user->getRememberTokenName() => $token]);

        $user->setRememberToken($token);
        $user->syncOriginalAttribute($user->getRememberTokenName());
    }

    /**
     * Revoke a single session and destroy the backing session storage.
     */
    public function revokeSession(User $user, UserSession $session, bool $destroy = true): void
    {
        if ($session->user_id !== $user->id) {
            Log::warning('UserSessionService: revokeSession blocked for mismatched user', [
                'user_id' => $user->id,
                'session_user_id' => $session->user_id,
                'session_db_id' => $session->id,
            ]);

            return;
        }

        $session->update(['revoked_at' => CarbonImmutable::now()]);
        $this->cycleRememberToken($user);

        $destroyed = !$destroy || $this->destroyBackingSession($user, $session);

        Log::info('UserSessionService: session revoked', [
            'user_id' => $user->id,
            'session_db_id' => $session->id,
            'destroyed' => $destroyed,
        ]);
    }

    /**
     * Convenience helper to revoke using a session id.
     */
    public function revokeBySessionId(User $user, string $sessionId, bool $destroy = true): void
    {
        $session = UserSession::query()
            ->where('user_id', $user->id)
            ->where('session_id', $sessionId)
            ->first();

        if ($session) {
            $this->revokeSession($user, $session, $destroy);
        }
    }

    /**
     * Revoke all sessions for the user, optionally keeping the provided session.
     */
    public function revokeAll(User $user, ?string $exceptSessionId = null): void
    {
        $sessions = DB::transaction(function () use ($user, $exceptSessionId) {
            User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            $query = UserSession::query()
                ->where('user_id', $user->id)
                ->when($exceptSessionId !== null, fn ($q) => $q->where('session_id', '!=', $exceptSessionId));
            $sessions = (clone $query)->get();

            // Mark every matching row before touching an external session
            // handler. A Redis/filesystem failure cannot leave later rows
            // authorized merely because their payload was destroyed second.
            $query->update(['revoked_at' => CarbonImmutable::now()]);

            return $sessions;
        });

        // Kill every recaller cookie too, otherwise "sign out everywhere" leaves
        // each revoked device able to re-authenticate from its remember-me cookie
        // on the next request.
        $this->cycleRememberToken($user);

        $destroyed = 0;
        foreach ($sessions as $session) {
            $destroyed += (int) $this->destroyBackingSession($user, $session);
        }

        Log::info('UserSessionService: revokeAll complete', [
            'user_id' => $user->id,
            'count' => $sessions->count(),
            'destroyed' => $destroyed,
            'except_session' => $exceptSessionId,
        ]);
    }

    /**
     * Destroy session-handler state without weakening the database revocation
     * boundary when the handler is unavailable.
     */
    private function destroyBackingSession(User $user, UserSession $session): bool
    {
        $destroyed = false;
        try {
            $destroyed = SessionFacade::getHandler()->destroy($session->session_id) !== false;
        } catch (\Throwable $exception) {
            Log::warning('UserSessionService: backing session destroy failed', [
                'user_id' => $user->id,
                'session_db_id' => $session->id,
                'exception' => $exception::class,
            ]);
        }

        try {
            if (session()->getId() === $session->session_id) {
                $guard = auth()->guard();
                if (method_exists($guard, 'logout')) {
                    $guard->logout();
                }
                session()->invalidate();
                session()->regenerateToken();
            }
        } catch (\Throwable $exception) {
            Log::warning('UserSessionService: current session cleanup failed', [
                'user_id' => $user->id,
                'session_db_id' => $session->id,
                'exception' => $exception::class,
            ]);
        }

        return $destroyed;
    }

    /**
     * Build a stable fingerprint using device id + /24 IP + user agent.
     */
    protected function fingerprint(string $deviceId): string
    {
        return hash('sha256', implode('|', [$deviceId, strtolower($this->userAgent()), $this->ipCIDR($this->ip())]));
    }

    protected function ipCIDR(string $ip): string
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            return implode('.', array_slice(explode('.', $ip), 0, 3));
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            return substr($ip, 0, 19);
        }

        return $ip;
    }

    protected function shouldNotify(?UserSession $session): bool
    {
        if (!$session) {
            return true;
        }

        $cooldownHours = (int) config('modules.auth.security.login_notification_cooldown_hours', 24);
        if (!$session->last_notified_at) {
            return true;
        }

        return $session->last_notified_at->lte(CarbonImmutable::now()->subHours($cooldownHours));
    }

    protected function userAgent(): string
    {
        return (string) ($this->request->userAgent() ?: 'Unknown device');
    }

    protected function currentDeviceId(): string
    {
        return (string) ($this->request->cookie(self::DEVICE_COOKIE) ?: $this->fallbackDeviceId());
    }

    protected function fallbackDeviceId(): string
    {
        return hash('sha256', implode('|', [strtolower($this->userAgent()), $this->ipCIDR($this->ip())]));
    }

    /**
     * Ensure a session record exists, re-associating to existing fingerprint if possible without notifying.
     */
    protected function ensureSessionExists(User $user, string $sessionId): ?UserSession
    {
        $existingSession = UserSession::query()
            ->where('user_id', $user->id)
            ->where(function ($q) use ($sessionId) {
                $q->where('session_id', $sessionId);
            })
            ->first();

        $payload = SessionFacade::getHandler()->read($sessionId);

        $deviceId = $this->currentDeviceId();
        $fingerprint = $this->fingerprint($deviceId);
        $now = CarbonImmutable::now();

        if ($existingSession) {
            // Keep session_id stable and refresh metadata, but do NOT un-revoke.
            $existingSession->forceFill([
                'session_id' => $sessionId,
                'device_fingerprint' => $fingerprint,
                'device_name' => $this->deviceName(),
                'user_agent' => $this->userAgent(),
                'ip_address' => $this->ip(),
                'location' => $this->location(),
                'last_activity_at' => $now,
            ])->save();

            return $existingSession;
        }

        // If the backing session payload is missing (likely destroyed), do not recreate.
        if (empty($payload)) {
            return null;
        }

        $fingerprintSession = UserSession::query()
            ->where('user_id', $user->id)
            ->where('device_fingerprint', $fingerprint)
            ->orderByDesc('last_activity_at')
            ->first();

        $session = UserSession::query()->updateOrCreate(
            [
                'user_id' => $user->id,
                'device_fingerprint' => $fingerprint,
            ],
            [
                'session_id' => $sessionId,
                'device_name' => $this->deviceName(),
                'user_agent' => $this->userAgent(),
                'ip_address' => $this->ip(),
                'location' => $this->location(),
                'last_activity_at' => $now,
                // Preserve revoked status for this fingerprint to honor revocations.
                'revoked_at' => $fingerprintSession?->revoked_at,
                'last_notified_at' => $fingerprintSession?->last_notified_at,
            ]
        );

        return $session;
    }

    protected function ip(): string
    {
        return (string) ($this->request->ip() ?: 'Unknown');
    }

    protected function location(): ?string
    {
        return null;
    }

    protected function deviceName(): ?string
    {
        $ua = $this->userAgent();

        // Rough device label fallback.
        if (str_contains($ua, '(')) {
            return trim(substr($ua, 0, 120));
        }

        return $ua ? mb_substr($ua, 0, 120) : null;
    }
}
