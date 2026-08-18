<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Server;
use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Privacy\RedactionMap;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\AiBudgetService;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Everest\Http\Controllers\Api\Concerns\HandlesAgentTurns;
use Everest\Http\Requests\Api\Application\Intelligence\AgentTurnRequest;
use Everest\Http\Requests\Api\Application\Intelligence\AgentDecisionRequest;
use Everest\Http\Requests\Api\Application\Intelligence\UpdateAiToolsRequest;
use Everest\Http\Requests\Api\Application\Intelligence\GetIntelligenceRequest;
use Everest\Http\Requests\Api\Application\Intelligence\AgentConversationRequest;

/**
 * Admin surface for the agent: the assistant itself, plus what it may call, at
 * what tier, and how loaded the inference backend is.
 *
 * Separate from IntelligenceController because that one governs the model
 * connection; this one governs the tool layer, and the two are edited by
 * different people at different times.
 *
 * The turn endpoints below have no server. Authorization is by AdminRole
 * capability rather than by subuser permission on a subject, which is checked
 * twice on every tool call — once by AuthorizeApplicationUser and once by the
 * endpoint's own request — so an administrator's assistant can never reach
 * further than the administrator can.
 */
class AiAgentController extends ApplicationApiController
{
    use HandlesAgentTurns;

    public function __construct(
        private ToolRegistry $registry,
        private RiskGate $riskGate,
        private ConsoleCommandGate $consoleGate,
        private InferenceGate $inferenceGate,
        private ProviderFactory $factory,
        private AgentRunner $runner,
        private TurnRecorder $recorder,
        private AiBudgetService $budget,
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

    /*
    |--------------------------------------------------------------------------
    | The admin assistant
    |--------------------------------------------------------------------------
    */

    /**
     * Start a turn.
     */
    public function start(AgentTurnRequest $request): StreamedResponse
    {
        $this->assertAgentAvailable();

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

            $conversation = $this->recorder->ensureConversation(
                $user,
                null,
                $this->resolveConversationId($request, $user->id),
                $query,
            );

            $context = new AgentContext(
                user: $user,
                server: null,
                turnId: (string) Str::uuid(),
                conversationId: $conversation?->id,
            );

            $context
                ->withMessages($this->recorder->loadHistory($conversation?->id))
                ->withRecorder($this->recorder);

            // Carried forward so a token minted three turns ago still means the same
            // person, and so the transcript on screen does not acquire a second name
            // for somebody it has already been talking about.
            $context->redactions = $this->recorder->loadRedactions($conversation);

            // A session opened on an earlier turn carries over, but only as far as
            // the capability check lets it: restoreAssist re-reads the server and
            // re-asks whether this administrator may still reach it, so a profile
            // narrowed since the approval closes the session rather than honouring
            // it.
            $context->assist = $this->recorder->loadAssist($conversation);
            $this->restoreAssist($context);

            $context->push(AiMessage::user($query));

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
     * Approvals and questions still awaiting a decision.
     */
    public function pending(GetIntelligenceRequest $request): JsonResponse
    {
        $owned = AiPendingAction::query()
            ->where('user_id', $request->user()->id)
            ->where('scope', ToolDefinition::SCOPE_ADMIN);

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
                'preview' => \Everest\Services\AI\Agent\ApprovalPreview::for(
                    $action->tool_name,
                    (array) $action->arguments,
                    $action->server_uuid ? Server::where('uuid', $action->server_uuid)->first() : null,
                ),
                'created_at' => $action->created_at?->toIso8601String(),
                'expires_at' => $action->expires_at?->toIso8601String(),
            ])->values(),
        ]);
    }

    /** Authoritative state used when an accepted SSE connection disappears. */
    public function turnStatus(GetIntelligenceRequest $request, string $turnId): JsonResponse
    {
        return $this->agentTurnStatus($request->user(), $turnId, null, ToolDefinition::SCOPE_ADMIN);
    }

    /** Stop a turn that is still running. */
    public function cancelTurn(GetIntelligenceRequest $request, string $turnId): JsonResponse
    {
        return $this->cancelAgentTurn($request->user(), $turnId, null, ToolDefinition::SCOPE_ADMIN);
    }

    /** Give up a queue place. */
    public function releaseQueue(GetIntelligenceRequest $request, string $ticket): JsonResponse
    {
        return $this->releaseQueuePlace($request->user(), $ticket);
    }

    /**
     * Approve, reject or answer a suspended turn, then resume it.
     *
     * Destructive server commands can be reached only inside a writable assist
     * session, and are confirmed against the live server name below.
     */
    public function decide(AgentDecisionRequest $request): StreamedResponse
    {
        $this->assertAgentAvailable();

        $user = $request->user();

        /** @var AiPendingAction|null $pending */
        $pending = AiPendingAction::query()
            ->where('turn_id', $request->input('turn_id'))
            ->where('user_id', $user->id)
            // Scoped to the admin surface, so a server chat's pending action
            // cannot be approved from here — where it would resume without the
            // server that authorized it.
            ->where('scope', ToolDefinition::SCOPE_ADMIN)
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

        if ($decision === 'answer') {
            $this->assertAnswerAcceptable($pending, (string) $request->input('answer', ''));
        }

        // Ahead of the claim, so a resume told to come back later leaves the
        // action exactly as it found it — still pending, still decidable. The
        // typed confirmation cannot be checked this early here, unlike on the
        // server surface: it is checked against the assist target, which only
        // exists once the turn has been restored. A refusal after this point
        // therefore hands the slot straight back rather than skipping it.
        $admission = $this->admitTurn($request, $user, InferenceGate::LANE_RESUME);

        if (!$admission->granted()) {
            return $this->queuedResponse($admission);
        }

        try {
            $conversation = $this->pendingConversation($pending, (int) $user->id);
            $context = $this->restoreTurn($pending, $user, null);

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

            if ($decision === 'approve') {
                $this->assertConfirmed($request, $pending, $context);
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

    /** Resolve the owned admin conversation whose state this resume may bank. */
    protected function pendingConversation(AiPendingAction $pending, int $userId): ?AiConversation
    {
        return $this->ownedPendingConversation($pending, $userId, AiConversation::SCOPE_ADMIN, null);
    }

    /** Destructive assist actions are confirmed against the live target row. */
    protected function assertConfirmed(
        AgentDecisionRequest $request,
        AiPendingAction $pending,
        AgentContext $context,
    ): void {
        if ($pending->risk !== ToolDefinition::RISK_DESTRUCTIVE) {
            return;
        }

        $target = $context->targetServer();
        if ($target === null) {
            abort(409, 'The server for this destructive action is no longer available.');
        }

        $typed = trim((string) $request->input('confirmation'));
        if (!hash_equals((string) $target->name, $typed)) {
            abort(422, 'Type the current server name exactly to confirm this action.');
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Transcripts
    |--------------------------------------------------------------------------
    |
    | Every query here is scoped to the acting administrator *and* to the admin
    | scope, so neither another admin's transcripts nor one's own server chats
    | can be reached through this surface.
    */

    public function conversations(AgentConversationRequest $request): JsonResponse
    {
        $conversations = $this->ownConversations($request->user()->id)
            ->orderByDesc('updated_at')
            ->limit(30)
            ->get();

        return response()->json([
            'data' => $conversations->map(fn (AiConversation $c) => [
                'id' => $c->id,
                'title' => $c->title,
                'is_saved' => (bool) $c->is_saved,
                'expires_at' => $c->expires_at?->toIso8601String(),
                'updated_at' => $c->updated_at?->toIso8601String(),
            ])->values(),
        ]);
    }

    public function conversation(AgentConversationRequest $request, int $conversationId): JsonResponse
    {
        $conversation = $this->ownConversations($request->user()->id)->findOrFail($conversationId);

        return response()->json([
            'data' => [
                'id' => $conversation->id,
                'title' => $conversation->title,
                'is_saved' => (bool) $conversation->is_saved,
                // The tokens this transcript was written against. Sent so the
                // administrator reads the values rather than the placeholders —
                // they are entitled to both, and it is the model that was not.
                // `all()` rather than the raw column: the stored shape carries
                // the map's salt alongside its values, and the salt is what
                // stops the tokens the provider sees from being a stable
                // pseudonym across conversations. It has no business on a wire
                // that a browser reads.
                'redactions' => RedactionMap::fromArray($conversation->redactions)->all(),
                'assist' => $conversation->assist ?: null,
                // The same fields the server transcript endpoint returns.
                // Dropping `tool_calls` and `tool_call_id` here meant a reopened
                // admin transcript reconstructed every tool row with empty
                // arguments and a synthetic id, so the record of what the model
                // asked the panel to do — which is the entire point of the
                // audit — disappeared on reload. Two parallel calls to the same
                // tool became indistinguishable at the same moment.
                'messages' => $conversation->messages->map(fn ($message) => [
                    'role' => $message->role,
                    'content' => $message->content,
                    'tool_calls' => $message->tool_calls,
                    'tool_call_id' => $message->tool_call_id,
                    'tool_name' => $message->tool_name,
                    'step' => $message->step,
                ])->values(),
            ],
        ]);
    }

    public function toggleSaveConversation(AgentConversationRequest $request, int $conversationId): JsonResponse
    {
        $conversation = $this->ownConversations($request->user()->id)->findOrFail($conversationId);

        $saved = !$conversation->is_saved;

        $conversation->update([
            'is_saved' => $saved,
            // Saving pins a transcript; unsaving hands it back to the reaper
            // with a fresh window rather than expiring it immediately.
            'expires_at' => $saved ? null : now()->addDays(AiConversation::EXPIRY_DAYS),
        ]);

        return response()->json(['data' => ['id' => $conversation->id, 'is_saved' => $saved]]);
    }

    /**
     * End the assist session a conversation has open.
     *
     * Access is re-authorized on every turn anyway, so this closes a door that
     * was already being checked — but an administrator who has finished with a
     * customer's server should be able to say so and see it stop, rather than
     * having to trust that starting a new chat was enough.
     */
    public function endAssist(AgentConversationRequest $request, int $conversationId): JsonResponse
    {
        $conversation = $this->ownConversations($request->user()->id)->findOrFail($conversationId);

        $conversation->update(['assist' => null]);

        return response()->json(['data' => ['id' => $conversation->id, 'assist' => null]]);
    }

    public function deleteConversation(AgentConversationRequest $request, int $conversationId): Response
    {
        $this->ownConversations($request->user()->id)->findOrFail($conversationId)->delete();

        return $this->returnNoContent();
    }

    private function ownConversations(int $userId): \Illuminate\Database\Eloquent\Builder
    {
        return AiConversation::query()
            ->where('user_id', $userId)
            ->where('scope', AiConversation::SCOPE_ADMIN);
    }

    /**
     * Ownership is re-checked rather than trusted, so a turn cannot be
     * attributed to somebody else's conversation — or to a server chat.
     */
    protected function resolveConversationId(Request $request, int $userId): ?int
    {
        $id = $request->input('conversation_id');

        if (!$id) {
            return null;
        }

        $owns = AiConversation::where('id', (int) $id)
            ->where('user_id', $userId)
            ->where('scope', AiConversation::SCOPE_ADMIN)
            ->exists();

        return $owns ? (int) $id : null;
    }

    /**
     * The admin assistant needs four things: the module on, the agent on, the
     * admin surface specifically on, and a model that can emit tool calls.
     *
     * The admin surface has its own switch because enabling the customer-facing
     * assistant should not silently hand the panel's own controls to a model.
     */
    protected function assertAgentAvailable(): void
    {
        foreach ([
            'modules:ai:enabled' => ['modules.ai.enabled', 'The AI module is not enabled.'],
            'modules:ai:agent:enabled' => ['modules.ai.agent.enabled', 'The AI agent has been disabled.'],
            'modules:ai:agent:admin_enabled' => ['modules.ai.agent.admin_enabled', 'The admin AI assistant has been disabled.'],
        ] as $key => [$config, $message]) {
            $enabled = filter_var(
                Setting::get('settings::' . $key, config($config, false)),
                FILTER_VALIDATE_BOOLEAN
            );

            if (!$enabled) {
                abort(403, $message);
            }
        }

        $capabilities = $this->factory
            ->make(ProviderFactory::TASK_AGENT)
            ->capabilities($this->factory->model(ProviderFactory::TASK_AGENT));

        if (!$capabilities->supportsTools) {
            abort(503, $capabilities->warnings[0]
                ?? 'The configured AI model does not support tool calling, so the agent cannot run.');
        }
    }

    /**
     * The tool catalogue, with each tool's declared tier alongside the tier it
     * actually runs at, so an operator can see at a glance what they changed.
     */
    public function tools(GetIntelligenceRequest $request): JsonResponse
    {
        $overrides = $this->riskGate->overrides();
        $disabled = $this->riskGate->disabledTools();

        $tools = [];

        foreach ($this->registry->all() as $definition) {
            $tools[] = [
                'name' => $definition->name,
                'description' => $definition->description,
                'scope' => $definition->scope,
                'group' => $definition->group,
                'method' => $definition->method,
                'default_risk' => $definition->risk,
                'risk' => $overrides[$definition->name] ?? $definition->risk,
                'overridden' => isset($overrides[$definition->name]),
                'enabled' => !in_array($definition->name, $disabled, true),
                // Both halves, so the catalogue does not read as though a tool
                // requiring any one of three permissions requires none.
                'permissions' => array_values(array_unique(array_merge(
                    $definition->permissions,
                    $definition->anyPermission,
                ))),
            ];
        }

        return response()->json([
            'data' => $tools,
            'groups' => $this->registry->groupDescriptions(),
            'risks' => ToolDefinition::RISKS,
            'console' => [
                // The built-in list is returned separately from the additions so
                // the editor can show what it is adding to rather than
                // presenting the defaults as user-entered text.
                'defaults' => ConsoleCommandGate::DEFAULT_SAFE,
                'extra' => $this->consoleExtras(),
            ],
        ]);
    }

    /**
     * Save tier overrides, disabled tools, and console allowlist additions.
     */
    public function updateTools(UpdateAiToolsRequest $request): Response
    {
        $known = array_keys($this->registry->all());

        // Unknown names are dropped rather than rejected: a tool can disappear
        // between the editor loading and the operator saving, and losing the
        // rest of their edits over a stale row would be the worse outcome.
        $overrides = array_filter(
            (array) $request->input('risk_overrides', []),
            fn ($risk, $name) => in_array($name, $known, true) && in_array($risk, ToolDefinition::RISKS, true),
            ARRAY_FILTER_USE_BOTH
        );

        $disabled = array_values(array_intersect(
            array_filter((array) $request->input('disabled_tools', []), 'is_string'),
            $known
        ));

        $console = array_values(array_unique(array_filter(array_map(
            fn ($value) => is_string($value) ? strtolower(trim($value)) : '',
            (array) $request->input('console_safe_commands', [])
        ))));

        Setting::set('settings::modules:ai:risk_overrides', json_encode($overrides));
        Setting::set('settings::modules:ai:disabled_tools', json_encode($disabled));
        Setting::set('settings::modules:ai:console:safe_commands', json_encode($console));

        Activity::event('admin:ai:tools')
            ->property('overrides', $overrides)
            ->property('disabled', $disabled)
            ->property('console_safe_commands', $console)
            ->description('AI agent tool policy was updated')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Live admission-control state, plus whether the configured model can
     * actually call tools.
     *
     * The capability probe is the one number that decides whether the agent
     * runs at all, so it belongs on the same card as the queue depth rather
     * than buried in a connection test.
     */
    public function inference(GetIntelligenceRequest $request): JsonResponse
    {
        $payload = [
            'queue' => $this->inferenceGate->stats(),
            'average_turn_ms' => $this->inferenceGate->averageTurnMs(),
            'resident_models' => [],
            'capabilities' => null,
        ];

        try {
            $model = $this->factory->model(ProviderFactory::TASK_AGENT);
            $provider = $this->factory->make(ProviderFactory::TASK_AGENT);

            $capabilities = $provider->capabilities($model);

            // Serialised by the DTO rather than picked apart here. Hand-rolling
            // this array is what left `toArray()` with no callers and four
            // capability fields reaching nothing, and it made adding a field a
            // five-place edit that failed silently if this one was missed.
            $payload['capabilities'] = ['model' => $model] + $capabilities->toArray();

            // Which models are actually resident is the difference between a
            // slow first token and a cold thirty-second load; only Ollama
            // reports it.
            if ($provider instanceof OllamaProvider) {
                $payload['resident_models'] = $provider->runningModels();
            }
        } catch (\Throwable $e) {
            Log::debug('AI inference probe failed: ' . $e->getMessage());
            $payload['error'] = $e->getMessage();
        }

        return response()->json($payload);
    }

    /**
     * Operator additions only — the built-in list is returned separately.
     */
    private function consoleExtras(): array
    {
        $stored = Setting::get('settings::modules:ai:console:safe_commands');

        if (!is_string($stored) || $stored === '') {
            return [];
        }

        $decoded = json_decode($stored, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }
}
