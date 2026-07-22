<?php

namespace Everest\Services\Auth;

use Everest\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\UserSession;
use Illuminate\Support\Facades\Log;
use Everest\Events\Email\NewLoginDetected;
use Illuminate\Support\Facades\Session as SessionFacade;

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
        $deviceId = $deviceId ?: Str::uuid()->toString();
        $fingerprint = $this->fingerprint($deviceId);
        $now = CarbonImmutable::now();
        $existingForFingerprint = UserSession::query()
            ->where('user_id', $user->id)
            ->where('device_fingerprint', $fingerprint)
            ->orderByDesc('created_at')
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
                $user,
                $this->ip(),
                $this->userAgent(),
                $correlationId,
                $now,
                $this->location()
            ));
        }

        return $session;
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
     * Revoke a single session and destroy the backing session storage.
     */
    public function revokeSession(User $user, UserSession $session, bool $destroy = true): void
    {
        if ($session->user_id !== $user->id) {
            Log::warning('UserSessionService: revokeSession blocked for mismatched user', [
                'user_id' => $user->id,
                'session_user_id' => $session->user_id,
                'session_id' => $session->id,
            ]);

            return;
        }

        $session->update(['revoked_at' => CarbonImmutable::now()]);

        if ($destroy) {
            SessionFacade::getHandler()->destroy($session->session_id);
            if (session()->getId() === $session->session_id) {
                $guard = auth()->guard();
                if (method_exists($guard, 'logout')) {
                    $guard->logout();
                }
                session()->invalidate();
                session()->regenerateToken();
            }
        }

        Log::info('UserSessionService: session revoked', [
            'user_id' => $user->id,
            'session_db_id' => $session->id,
            'destroyed' => $destroy,
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
        $sessions = UserSession::query()
            ->where('user_id', $user->id)
            ->when($exceptSessionId, fn ($q) => $q->where('session_id', '!=', $exceptSessionId))
            ->get();

        foreach ($sessions as $session) {
            $this->revokeSession($user, $session);
        }

        Log::info('UserSessionService: revokeAll complete', [
            'user_id' => $user->id,
            'count' => $sessions->count(),
            'except_session' => $exceptSessionId,
        ]);
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
