<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\ApprovalPreview;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\AiBudgetService;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Controllers\Api\Concerns\HandlesAgentTurns;

/**
 * The tool-calling agent.
 *
 * Kept separate from AIController — which remains the plain chat and crash
 * analysis surface — because the two have genuinely different contracts: this
 * one can suspend mid-turn and be resumed by a later request.
 *
 * The streaming, resume and suspension mechanics live in HandlesAgentTurns,
 * shared with the admin assistant. What stays here is what is genuinely
 * server-specific: binding the server from the route, scoping every lookup to
 * it, and confirming a destructive action by typing the server's name.
 */
class AgentController extends ClientApiController
{
    use HandlesAgentTurns;

    public function __construct(
        private AgentRunner $runner,
        private ProviderFactory $factory,
        private ToolRegistry $registry,
        private RiskGate $riskGate,
        private AiBudgetService $budget,
        private TurnRecorder $recorder,
    ) {
        parent::__construct();
    }

    protected function agentRunner(): AgentRunner
    {
        return $this->runner;
    }

    protected function toolRegistry(): ToolRegistry
    {
        return $this->registry;
    }

    protected function toolRiskGate(): RiskGate
    {
        return $this->riskGate;
    }

    protected function turnRecorder(): TurnRecorder
    {
        return $this->recorder;
    }

    protected function providerFactory(): ProviderFactory
    {
        return $this->factory;
    }

    /**
     * Start a turn.
     */
    public function start(Request $request, Server $server): StreamedResponse|JsonResponse
    {
        $this->assertAgentAvailable($request);

        $request->validate([
            'query' => 'required|string|min:1|max:8000',
            'conversation_id' => 'nullable|integer',
            'console' => 'nullable|string|max:20000',
            'ticket' => 'nullable|string|max:64',
        ]);

        $user = $request->user();

        // Before the message is recorded, so a turn told to come back later has
        // changed nothing and the client can simply present its ticket again.
        $admission = $this->admitTurn($request, $user, InferenceGate::LANE_NEW);

        if (!$admission->granted()) {
            return $this->queuedResponse($admission);
        }

        $reservation = $this->budget->reserve($user);

        try {
            $query = (string) $request->input('query');

            // The turn owns its conversation. History comes from what the panel
            // stored rather than from what the client sends back, so a client
            // cannot rewrite the past to steer the model.
            $conversation = $this->recorder->ensureConversation(
                $user,
                $server,
                $this->resolveConversationId($request, $user->id, $server->uuid),
                $query,
            );

            $context = new AgentContext(
                user: $user,
                server: $server,
                turnId: (string) Str::uuid(),
                conversationId: $conversation?->id,
                consoleBuffer: $request->input('console'),
            );

            $context
                ->withMessages($this->recorder->loadHistory($conversation?->id))
                ->withRecorder($this->recorder);

            // Carried forward so a token minted on an earlier turn still stands for
            // the same value on this one.
            $context->redactions = $this->recorder->loadRedactions($conversation);

            $context->push(AiMessage::user($query));

            // With durable execution on, the request's job is finished here: the
            // turn has been admitted, the conversation exists and what the user
            // said is recorded, so a worker can pick it up knowing everything a
            // request knew. The response carries the turn id the client reads
            // the turn back through.
            if ($this->agentDurable()) {
                return $this->dispatchDurableTurn(
                    $context,
                    conversation: $conversation,
                    budgetReservation: $reservation,
                    lease: $admission->lease,
                );
            }

            return $this->streamTurn(
                $context,
                conversation: $conversation,
                budgetReservation: $reservation,
                lease: $admission->lease,
            );
        } catch (\Throwable $e) {
            $reservation->release();
            $admission->lease?->release();

            throw $e;
        }
    }

    /**
     * Approvals and questions the user still owes a decision on.
     *
     * A suspended turn closes its stream, so without this a reload loses the
     * only pointer to it and the action silently expires.
     */
    public function pending(Request $request, Server $server): JsonResponse
    {
        $this->assertAgentEnabled($request);

        $owned = AiPendingAction::query()
            ->where('user_id', $request->user()->id)
            ->where('server_uuid', $server->uuid);

        $this->sweepExpiredPending($owned);

        $pending = (clone $owned)->actionable()
            ->orderByDesc('created_at')
            ->limit(10)
            ->get();

        return response()->json([
            'data' => $pending->map(fn (AiPendingAction $action) => [
                'turn_id' => $action->turn_id,
                'conversation_id' => $action->conversation_id,
                'tool' => $action->tool_name,
                'arguments' => $action->arguments,
                'risk' => $action->risk,
                'preview' => ApprovalPreview::for($action->tool_name, (array) $action->arguments),
                'created_at' => $action->created_at?->toIso8601String(),
                'expires_at' => $action->expires_at?->toIso8601String(),
            ])->values(),
        ]);
    }

    /** Authoritative state used when an accepted SSE connection disappears. */
    public function turnStatus(Request $request, Server $server, string $turnId): JsonResponse
    {
        $this->assertAgentEnabled($request);

        return $this->agentTurnStatus($request->user(), $turnId, $server, ToolDefinition::SCOPE_SERVER);
    }

    /**
     * Read a running turn as an event stream, resuming from a cursor.
     *
     * The reconnect path. A client that lost its stream — navigated away,
     * reloaded, came back on a different device — reopens the turn here with the
     * last sequence it saw, and gets the frames it missed followed by the live
     * ones. Nothing about the turn depends on anyone being connected.
     */
    public function stream(Request $request, Server $server, string $turnId): StreamedResponse
    {
        $this->assertAgentEnabled($request);

        return $this->relayTurn(
            $request->user(),
            $turnId,
            $server,
            ToolDefinition::SCOPE_SERVER,
            (int) $request->query('after', 0),
        );
    }

    /**
     * The turn this user currently has in flight, if any.
     *
     * What a freshly loaded page asks so it can rejoin. Until now nothing could
     * answer it: `turnStatus` needs a turn id the reloaded page no longer has,
     * and `pending` only knows about turns that already stopped for a decision.
     * A page that could not tell a working turn from no turn at all is exactly
     * why leaving the tab looked like nothing was happening.
     *
     * Singular by construction — `concurrency.per_user` admits one turn at a
     * time — so this is "the" active turn rather than a list to choose from.
     */
    public function activeTurn(Request $request, Server $server): JsonResponse
    {
        $this->assertAgentEnabled($request);

        return $this->activeAgentTurn($request->user(), $server);
    }

    /** Stop a turn that is still running. */
    public function cancelTurn(Request $request, Server $server, string $turnId): JsonResponse
    {
        $this->assertAgentEnabled($request);

        return $this->cancelAgentTurn($request->user(), $turnId, $server, ToolDefinition::SCOPE_SERVER);
    }

    /**
     * Give up a queue place.
     *
     * Not gated on the agent being enabled: a user holding a ticket when an
     * administrator switches the feature off should still be able to hand it
     * back, rather than being counted against their own per-user limit until it
     * lapses.
     */
    public function releaseQueue(Request $request, Server $server, string $ticket): JsonResponse
    {
        return $this->releaseQueuePlace($request->user(), $ticket);
    }

    /**
     * Approve, reject or answer a suspended action, then resume the turn.
     *
     * The decision arrives on a fresh request because the stream that asked
     * for it closed when the turn suspended — an approval can be minutes
     * later, and holding a worker open for that is not an option.
     */
    public function decide(Request $request, Server $server): StreamedResponse
    {
        $this->assertAgentAvailable($request);

        $request->validate([
            'turn_id' => 'required|uuid',
            'decision' => 'required|string|in:approve,reject,answer',
            'confirmation' => 'nullable|string|max:255',
            'answer' => 'nullable|string|max:500',
            'ticket' => 'nullable|string|max:64',
        ]);

        $user = $request->user();

        /** @var AiPendingAction|null $pending */
        $pending = AiPendingAction::query()
            ->where('turn_id', $request->input('turn_id'))
            ->where('user_id', $user->id)
            // Scoped to the server on the route, so a pending action cannot be
            // approved from a different server's chat.
            ->where('server_uuid', $server->uuid)
            ->first();

        if ($pending === null) {
            abort(404, 'That pending action no longer exists.');
        }

        $this->recoverStaleClaim($pending);

        if ($this->expireIfStale($pending)) {
            abort(404, 'That pending action has expired.');
        }

        if ($pending->status !== AiPendingAction::STATUS_PENDING) {
            return $this->existingDecisionResponse($pending);
        }

        $decision = (string) $request->input('decision');
        $this->assertDecisionMatchesPending($pending, $decision);

        // Everything that can refuse this decision outright runs before a slot
        // is taken, so a mistyped confirmation costs nobody their place in line.
        if ($decision === 'approve') {
            $this->assertConfirmed($request, $pending, $server);
        }

        if ($decision === 'answer') {
            $this->assertAnswerAcceptable($pending, (string) $request->input('answer', ''));
        }

        // Ahead of the claim, so a resume told to come back later leaves the
        // action exactly as it found it — still pending, still decidable.
        $admission = $this->admitTurn($request, $user, InferenceGate::LANE_RESUME);

        if (!$admission->granted()) {
            return $this->queuedResponse($admission);
        }

        try {
            $conversation = $this->pendingConversation($pending, (int) $user->id, $server);
            $context = $this->restoreTurn($pending, $user, $server);

            if ($decision === 'reject') {
                $reservation = $this->budget->reserve($user);

                try {
                    if (!$this->claimRejection($pending)) {
                        $reservation->release();
                        $admission->lease?->release();

                        return $this->existingDecisionResponse($pending);
                    }
                    $this->applyRejection($pending, $context);

                    return $this->streamTurn(
                        $context,
                        $pending,
                        conversation: $conversation,
                        budgetReservation: $reservation,
                        lease: $admission->lease,
                    );
                } catch (\Throwable $e) {
                    $reservation->release();

                    throw $e;
                }
            }

            $reservation = $this->budget->reserve($user);

            try {
                if (!$this->claimPending($pending)) {
                    $reservation->release();
                    $admission->lease?->release();

                    return $this->existingDecisionResponse($pending);
                }
                $context->executionKey = $pending->execution_key;

                if ($decision === 'answer') {
                    $this->applyAnswer($pending, $context, (string) $request->input('answer', ''));
                }

                return $this->streamTurn(
                    $context,
                    $pending,
                    conversation: $conversation,
                    budgetReservation: $reservation,
                    lease: $admission->lease,
                );
            } catch (\Throwable $e) {
                $this->abandonClaim($pending, $reservation);

                throw $e;
            }
        } catch (\Throwable $e) {
            $admission->lease?->release();

            throw $e;
        }
    }

    /**
     * Resolve the owned conversation whose state this resume may bank.
     *
     * Without it, `TurnRecorder::touch()` is handed nothing and every token the
     * resumed leg minted is lost — the next turn re-mints them, and the same
     * customer acquires a second name halfway down their own transcript.
     */
    protected function pendingConversation(AiPendingAction $pending, int $userId, Server $server): ?AiConversation
    {
        return $this->ownedPendingConversation($pending, $userId, AiConversation::SCOPE_SERVER, $server->uuid);
    }

    /**
     * A destructive action needs the user to type the server's name — the same
     * bar the panel applies to deleting one by hand.
     */
    protected function assertConfirmed(Request $request, AiPendingAction $pending, Server $server): void
    {
        if ($pending->risk !== ToolDefinition::RISK_DESTRUCTIVE) {
            return;
        }

        $typed = trim((string) $request->input('confirmation'));

        if (!hash_equals((string) $server->name, $typed)) {
            abort(422, 'Type the server name exactly to confirm this action.');
        }
    }

    protected function resolveConversationId(Request $request, int $userId, string $serverUuid): ?int
    {
        $id = $request->input('conversation_id');

        if (!$id) {
            return null;
        }

        // Ownership is re-checked rather than trusted, so a turn cannot be
        // attributed to somebody else's conversation.
        $owns = AiConversation::where('id', (int) $id)
            ->where('user_id', $userId)
            ->where('server_uuid', $serverUuid)
            ->exists();

        return $owns ? (int) $id : null;
    }

    /**
     * The agent needs three things: the module on, the agent feature on, and a
     * model that can actually emit tool calls.
     */
    protected function assertAgentAvailable(Request $request): void
    {
        $this->assertAgentEnabled($request);

        $capabilities = $this->factory
            ->make(ProviderFactory::TASK_AGENT)
            ->capabilities($this->factory->model(ProviderFactory::TASK_AGENT));

        if (!$capabilities->supportsTools) {
            abort(503, $capabilities->warnings[0]
                ?? 'The configured AI model does not support tool calling, so the agent cannot run.');
        }
    }

    /** The customer-agent kill switches apply equally to every account. */
    protected function assertAgentEnabled(Request $request): void
    {
        $enabled = filter_var(
            Setting::get('settings::modules:ai:enabled', config('modules.ai.enabled', false)),
            FILTER_VALIDATE_BOOLEAN
        );

        if (!$enabled) {
            abort(403, 'The AI module is not enabled.');
        }

        $agentEnabled = filter_var(
            Setting::get('settings::modules:ai:agent:enabled', config('modules.ai.agent.enabled', false)),
            FILTER_VALIDATE_BOOLEAN
        );

        if (!$agentEnabled) {
            abort(403, 'The AI agent has been disabled by the administrator.');
        }
    }
}
