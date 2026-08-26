<?php

namespace Everest\Services\AI\Agent;

use IPTools\IP;
use IPTools\Range;
use Everest\Models\User;
use Everest\Models\ApiKey;
use Illuminate\Http\Request;
use Everest\Models\UserSession;

/**
 * Who a durable turn runs as, and for how long that stays true. A request-bound
 * turn ended with its request; once execution moves to a worker the two come
 * apart, and a turn that keeps its authority after the user logged out is a
 * credential with no owner.
 *
 * The identity is credential-equivalent: browser turns retain their originating
 * session, while API turns retain the key id and originating address. The secret
 * key itself never enters the queue payload; workers reload the database row and
 * therefore observe revocation, expiry, type/profile changes and IP restrictions.
 *
 * Validity is re-derived, never cached: `stillHeld()` is re-asked at every step
 * boundary, so logging out or suspending the account stops the turn at the next
 * safe point.
 */
final class TurnAuthority
{
    public function __construct(
        public readonly int $userId,
        /**
         * The session the turn was started from, when it was started from one.
         *
         * Null for a turn begun with an API key; apiKeyId then carries the
         * independently revocable credential boundary.
         */
        public readonly ?string $sessionId,
        /** The originating client address, kept so tool activity is attributed to it. */
        public readonly ?string $ip,
        /** Scheme and host of the request that started the turn, for URL generation. */
        public readonly string $origin,
        /** The API key that started the turn, or null for browser-session turns. */
        public readonly ?int $apiKeyId = null,
    ) {
    }

    public static function capture(Request $request, User $user): self
    {
        $token = $user->currentAccessToken();

        return new self(
            userId: $user->id,
            sessionId: $request->hasSession() ? $request->session()->getId() : null,
            ip: $request->ip(),
            origin: $request->getSchemeAndHttpHost(),
            apiKeyId: $token instanceof ApiKey ? $token->id : null,
        );
    }

    /** @param array<string, mixed> $data */
    public static function fromArray(array $data): self
    {
        return new self(
            userId: (int) ($data['user_id'] ?? 0),
            sessionId: isset($data['session_id']) ? (string) $data['session_id'] : null,
            ip: isset($data['ip']) ? (string) $data['ip'] : null,
            origin: (string) ($data['origin'] ?? config('app.url')),
            apiKeyId: isset($data['api_key_id']) ? (int) $data['api_key_id'] : null,
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'user_id' => $this->userId,
            'session_id' => $this->sessionId,
            'ip' => $this->ip,
            'origin' => $this->origin,
            'api_key_id' => $this->apiKeyId,
        ];
    }

    /**
     * The user this turn runs as, or null if the account is gone.
     */
    public function user(): ?User
    {
        return User::query()->find($this->userId);
    }

    /** Reload the originating API key without ever serialising its secret. */
    public function apiKey(): ?ApiKey
    {
        if ($this->apiKeyId === null) {
            return null;
        }

        return ApiKey::query()
            ->whereKey($this->apiKeyId)
            ->where('user_id', $this->userId)
            ->first();
    }

    /**
     * Whether the authority that started this turn is still in force. Three ways
     * it lapses, all deliberate acts: the account was deleted or suspended, or
     * the originating device was signed out or revoked. A password reset arrives
     * through the third, since revoking sessions is how the panel expresses it.
     *
     * Deliberately silent about *which* failed — the caller turns this into a
     * cancelled turn, and a user does not need their own account state explained
     * back to them in a transcript.
     */
    public function stillHeld(): bool
    {
        $user = $this->user();

        if ($user === null || $user->state === 'suspended') {
            return false;
        }

        if ($this->apiKeyId !== null) {
            $key = $this->apiKey();

            if ($key === null || ($key->expires_at !== null && $key->expires_at->isPast())) {
                return false;
            }

            if (empty($key->allowed_ips)) {
                return true;
            }

            if ($this->ip === null) {
                return false;
            }

            try {
                $origin = new IP($this->ip);

                foreach ($key->allowed_ips as $allowed) {
                    if (Range::parse($allowed)->contains($origin)) {
                        return true;
                    }
                }
            } catch (\Throwable) {
                return false;
            }

            return false;
        }

        if ($this->sessionId === null) {
            // A sessionless payload without a key id cannot prove what authority
            // created it. This also fails closed for jobs queued by an older
            // release rather than briefly preserving the defect during deploy.
            return false;
        }

        return UserSession::query()
            ->where('user_id', $this->userId)
            ->where('session_id', $this->sessionId)
            ->active()
            ->exists();
    }
}
