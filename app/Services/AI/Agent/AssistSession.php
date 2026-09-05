<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Everest\Models\Server;

/**
 * The window during which an assist binding is actually in force — the single
 * exception `AuthenticateServerAccess` and `ServerPolicy` consult for a
 * delegated administrator who is neither the server owner nor a panel Owner.
 *
 * Kept as small as possible: not open for the request, turn or conversation.
 * {@see AgentRunner} opens it around one dispatched sub-request and closes it in
 * a `finally`, so anything else in the same PHP request sees the ordinary
 * refusal. `during()` is the only way in, so no code path opens a session and
 * forgets to close it.
 *
 * A singleton, since its two consumers are a middleware and a policy that the
 * runner could not otherwise reach.
 */
class AssistSession
{
    private ?AssistBinding $binding = null;

    private ?int $userId = null;

    /**
     * Run something with the binding in force, and take it back out again.
     *
     * @template T
     *
     * @param callable(): T $run
     *
     * @return T
     */
    public function during(User $user, AssistBinding $binding, callable $run): mixed
    {
        // Nesting would let an inner binding's narrower grant be silently
        // replaced by a wider one on the way out. Nothing nests today; this is
        // here so that stays true by construction rather than by convention.
        if ($this->binding !== null) {
            throw new \LogicException('An assist session is already open.');
        }

        $this->binding = $binding;
        $this->userId = $user->id;

        try {
            return $run();
        } finally {
            $this->binding = null;
            $this->userId = null;
        }
    }

    /**
     * Whether this user is presently assisting this server at all.
     *
     * Consulted by `AuthenticateServerAccess`, which asks only whether the door
     * opens — the endpoint's own permission gate decides what is behind it.
     */
    public function covers(User $user, Server $server): bool
    {
        return $this->binding !== null
            && $this->userId === $user->id
            && $this->binding->serverUuid === $server->uuid;
    }

    /**
     * Whether this user may take one specific action on this server right now.
     *
     * Consulted by `ServerPolicy::before()`. A binding grants an explicit list,
     * so an ability outside it is refused exactly as it would be for anybody
     * else — which is what keeps a read-only session read-only even if a tool it
     * was never offered somehow reaches dispatch.
     */
    public function permits(User $user, Server $server, string $ability): bool
    {
        return $this->covers($user, $server) && $this->binding?->permits($ability) === true;
    }

    /**
     * The binding in force, if any. For diagnostics; authorization should ask
     * one of the two questions above rather than reading this.
     */
    public function current(): ?AssistBinding
    {
        return $this->binding;
    }
}
