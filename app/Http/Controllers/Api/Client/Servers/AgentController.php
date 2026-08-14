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
use Everest\Services\AI\Agent\ApprovalPreview;
use Everest\Services\AI\Support\AiBudgetService;
use Everest\Services\AI\Tools\Definitions\SharedTools;
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
    public function start(Request $request, Server $server): StreamedResponse
    {
        $this->assertAgentAvailable($request);

        $request->validate([
            'query' => 'required|string|min:1|max:8000',
            'conversation_id' => 'nullable|integer',
            'console' => 'nullable|string|max:20000',
        ]);

        $user = $request->user();
        $this->budget->assertWithinBudget($user);

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

        return $this->streamTurn($context, conversation: $conversation);
    }

    /**
     * Approvals and questions the user still owes a decision on.
     *
     * A suspended turn closes its stream, so without this a reload loses the
     * only pointer to it and the action silently expires.
     */
    public function pending(Request $request, Server $server): JsonResponse
    {
        $pending = AiPendingAction::actionable()
            ->where('user_id', $request->user()->id)
            ->where('server_uuid', $server->uuid)
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
        ]);

        $user = $request->user();

        /** @var AiPendingAction|null $pending */
        $pending = AiPendingAction::actionable()
            ->where('turn_id', $request->input('turn_id'))
            ->where('user_id', $user->id)
            // Scoped to the server on the route, so a pending action cannot be
            // approved from a different server's chat.
            ->where('server_uuid', $server->uuid)
            ->first();

        if ($pending === null) {
            abort(404, 'That pending action no longer exists, or has expired.');
        }

        $decision = (string) $request->input('decision');
        $context = $this->restoreTurn($pending, $user, $server);

        if ($decision === 'reject') {
            $this->applyRejection($pending, $context);

            return $this->streamTurn($context, $pending);
        }

        if ($decision === 'answer') {
            $this->assertAnswerable($pending);
            $this->budget->assertWithinBudget($user);
            $this->applyAnswer($pending, $context, (string) $request->input('answer', ''));

            return $this->streamTurn($context, $pending);
        }

        $this->assertConfirmed($request, $pending, $server);
        $this->budget->assertWithinBudget($user);

        $pending->update(['status' => AiPendingAction::STATUS_APPROVED]);

        return $this->streamTurn($context, $pending);
    }

    /**
     * A destructive action needs the user to type the server's name — the same
     * bar the panel applies to deleting one by hand.
     */
    protected function assertConfirmed(Request $request, AiPendingAction $pending, Server $server): void
    {
        if ($pending->risk !== \Everest\Services\AI\Tools\ToolDefinition::RISK_DESTRUCTIVE) {
            return;
        }

        $typed = trim((string) $request->input('confirmation'));

        if (strcasecmp($typed, $server->name) !== 0) {
            abort(422, 'Type the server name exactly to confirm this action.');
        }
    }

    /**
     * Only a question can be answered. Anything else arriving with
     * `decision: answer` is a client bug, and running the pending tool on the
     * strength of it would be an approval nobody gave.
     */
    protected function assertAnswerable(AiPendingAction $pending): void
    {
        if ($pending->tool_name !== SharedTools::ASK_USER) {
            abort(422, 'That pending action is waiting for approval, not an answer.');
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

        if (!$agentEnabled && !$request->user()->isOwner()) {
            abort(403, 'The AI agent has been disabled by the administrator.');
        }

        $capabilities = $this->factory
            ->make(ProviderFactory::TASK_AGENT)
            ->capabilities($this->factory->model(ProviderFactory::TASK_AGENT));

        if (!$capabilities->supportsTools) {
            abort(503, $capabilities->warnings[0]
                ?? 'The configured AI model does not support tool calling, so the agent cannot run.');
        }
    }
}
