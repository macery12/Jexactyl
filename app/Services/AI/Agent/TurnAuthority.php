<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Illuminate\Http\Request;
use Everest\Models\UserSession;

/**
 * Who a durable turn runs as, and for how long that stays true.
 *
 * A request-bound turn never needed this: the authority was the request, and
 * when the request ended so did the turn. Once execution moves to a worker the
 * two come apart, and the gap is the whole security question — a turn that
 * keeps its authority after the user logged out is a credential with no owner.
 *
 * The identity is deliberately **session-equivalent**: the worker presents the
 * user exactly as the browser did, holding a `TransientToken`. It does not
 * replay an API credential. That is not laziness about scope, it is the honest
 * shape of the thing — every durable turn is started from the panel UI by a
 * logged-in human, and re-presenting a token would mean evaluating an API key's
 * IP allowlist against a stored address rather than a real peer, which is a
 * check that reads as enforcement while being unable to enforce anything.
 *
 * Validity is re-derived, never cached. `stillHeld()` is asked again at every
 * step boundary, so logging out, revoking the device, or suspending the account
 * stops the turn at the next safe point rather than at the next turn.
 */
final class TurnAuthority
{
    public function __construct(
        public readonly int $userId,
        /**
         * The session the turn was started from, when it was started from one.
         *
         * Null for a turn begun with an API key, where there is no session to
         * revoke and the account's own state is the only thing left to check.
         */
        public readonly ?string $sessionId,
        /** The originating client address, kept so tool activity is attributed to it. */
        public readonly ?string $ip,
        /** Scheme and host of the request that started the turn, for URL generation. */
        public readonly string $origin,
    ) {
    }

    public static function capture(Request $request, User $user): self
    {
        return new self(
            userId: $user->id,
            sessionId: $request->hasSession() ? $request->session()->getId() : null,
            ip: $request->ip(),
            origin: $request->getSchemeAndHttpHost(),
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
        ];
    }

    /**
     * The user this turn runs as, or null if the account is gone.
     */
    public function user(): ?User
    {
        return User::query()->find($this->userId);
    }

    /**
     * Whether the authority that started this turn is still in force.
     *
     * Three ways it can lapse, and all three are things a person did on purpose:
     * the account was deleted, the account was suspended, or the device the turn
     * was started from was signed out or revoked. A password reset reaches this
     * through the third — revoking sessions is how the panel already expresses
     * "everything that was logged in is not any more".
     *
     * Deliberately silent about *which* one failed. The caller turns this into a
     * cancelled turn, and a user watching a transcript does not need the turn to
     * explain the state of their own account back to them.
     */
    public function stillHeld(): bool
    {
        $user = $this->user();

        if ($user === null || $user->state === 'suspended') {
            return false;
        }

        if ($this->sessionId === null) {
            return true;
        }

        return UserSession::query()
            ->where('user_id', $this->userId)
            ->where('session_id', $this->sessionId)
            ->active()
            ->exists();
    }
}
