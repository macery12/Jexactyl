<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Facades\Activity;
use Everest\Models\AdminRole;
use Everest\Services\Authorization\AdminAuthorizer;

/**
 * Decides whether an administrator may open an assist session, and records it.
 *
 * Kept out of {@see AgentRunner} because it is the security decision of this
 * feature and deserves to be somewhere a reviewer can find all of it: who is
 * allowed in, which server they are allowed into, and what gets written down
 * about it. The runner's job is only to ask.
 *
 * The capability is checked here on the way in *and* again on every resume, and
 * the answer is never read from stored turn state — an administrator whose
 * Access Profile is narrowed while an approval sits on screen must not be able
 * to complete it by clicking Approve.
 */
class AssistAuthorizer
{
    public function __construct(
        private AdminAuthorizer $authorizer,
        private AssistSession $session,
    ) {
    }

    /**
     * Run one dispatched tool call with the binding in force.
     *
     * The runner asks this rather than the session directly so there is a single
     * object that owns "may they, and while they do" — and so the window stays
     * as short as the call it wraps.
     *
     * @template T
     *
     * @param callable(): T $run
     *
     * @return T
     */
    public function during(User $admin, AssistBinding $binding, callable $run): mixed
    {
        return $this->session->during($admin, $binding, $run);
    }

    /**
     * Whether this administrator may assist any server at all.
     */
    public function permitted(User $admin): bool
    {
        return $this->authorizer->hasCapability($admin, AdminRole::SERVERS_ASSIST);
    }

    /**
     * Resolve the server the model named.
     *
     * Accepts an id, a uuid or the short uuid, because the model gets all three
     * from different listings and being strict here only produces a retry that
     * looks like a fault. Returns null when nothing matches — the caller turns
     * that into a tool error the model can act on, not an exception.
     */
    public function resolveServer(string $reference): ?Server
    {
        $reference = trim($reference);

        if ($reference === '') {
            return null;
        }

        $query = Server::query();

        if (ctype_digit($reference)) {
            return $query->find((int) $reference);
        }

        return $query
            ->where(strlen($reference) === 8 ? 'uuidShort' : 'uuid', $reference)
            ->first();
    }

    /**
     * Re-attach a restored binding to its server, or refuse it.
     *
     * Called on resume, where everything about the binding arrived from a JSON
     * column. Both questions are asked again from scratch: does the server still
     * exist, and does this administrator still hold the capability.
     */
    public function reauthorize(User $admin, AssistBinding $binding): ?Server
    {
        if (!$this->permitted($admin)) {
            return null;
        }

        return Server::query()->where('uuid', $binding->serverUuid)->first();
    }

    /**
     * Write the session into the server's own activity feed.
     *
     * This is the part that makes the feature defensible rather than merely
     * convenient. The customer can see, in the same place they see their own
     * logins and file edits, that a named member of staff looked inside their
     * server, when, and why. Support access nobody can audit is not support
     * access.
     *
     * Failure is logged and swallowed: an activity row that cannot be written
     * is not a reason to strand a turn that has already been approved.
     */
    public function record(User $admin, Server $server, AssistBinding $binding, bool $escalation = false): void
    {
        try {
            Activity::event($escalation ? 'server:ai.assist.escalate' : 'server:ai.assist.start')
                ->actor($admin)
                ->subject($server)
                ->property([
                    'administrator' => $admin->username,
                    'reason' => $binding->reason,
                    'ticket_id' => $binding->ticketId,
                    'abilities' => $binding->abilities,
                ])
                ->log();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning(
                'Failed to log an AI assist session on server ' . $server->uuid . ': ' . $e->getMessage()
            );
        }
    }
}
