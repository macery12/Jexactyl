<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\AiToolCall;
use Everest\Models\AiUsageLog;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Support\AiBudgetService;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Everest\Http\Controllers\Api\Client\ClientApiController;

/**
 * The tool-calling agent.
 *
 * Kept separate from AIController — which remains the plain chat and crash
 * analysis surface — because the two have genuinely different contracts: this
 * one can suspend mid-turn and be resumed by a later request.
 */
class AgentController extends ClientApiController
{
    public function __construct(
        private AgentRunner $runner,
        private ProviderFactory $factory,
        private ToolRegistry $registry,
        private RiskGate $riskGate,
        private AiBudgetService $budget,
    ) {
        parent::__construct();
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
            'messages' => 'nullable|array|max:20',
            'messages.*.role' => 'required_with:messages|in:user,assistant',
            'messages.*.content' => 'required_with:messages|string|max:4000',
        ]);

        $user = $request->user();
        $this->budget->assertWithinBudget($user);

        $context = new AgentContext(
            user: $user,
            server: $server,
            turnId: (string) Str::uuid(),
            conversationId: $this->resolveConversationId($request, $user->id, $server->uuid),
            consoleBuffer: $request->input('console'),
        );

        $context->withMessages($this->buildHistory($request));

        return $this->stream($context, $server);
    }

    /**
     * Approve or reject a suspended action, then resume the turn.
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
            'decision' => 'required|string|in:approve,reject',
            'confirmation' => 'nullable|string|max:255',
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

        if ($request->input('decision') === 'reject') {
            return $this->resolveRejection($pending, $server, $user);
        }

        $this->assertConfirmed($request, $pending, $server);
        $this->budget->assertWithinBudget($user);

        $pending->update(['status' => AiPendingAction::STATUS_APPROVED]);

        $context = AgentContext::fromState(
            $user,
            $server,
            $pending->turn_id,
            $pending->conversation_id,
            $pending->state,
        );

        return $this->stream($context, $server, $pending);
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

    protected function resolveRejection(AiPendingAction $pending, Server $server, $user): StreamedResponse
    {
        $pending->update(['status' => AiPendingAction::STATUS_REJECTED]);

        AiToolCall::where('turn_id', $pending->turn_id)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->update(['status' => AiToolCall::STATUS_REJECTED, 'resolved_at' => now()]);

        // Resume the turn with the refusal fed back as the tool result, so the
        // model can offer an alternative instead of the conversation dead-ending.
        $context = AgentContext::fromState($user, $server, $pending->turn_id, $pending->conversation_id, $pending->state);
        $context->push(AiMessage::tool(
            'rejected',
            $pending->tool_name,
            json_encode(['ok' => false, 'error' => 'declined_by_user', 'message' => 'The user declined this action. Do not retry it; suggest an alternative or ask what they would prefer.']),
            true,
        ));

        return $this->stream($context, $server, $pending);
    }

    /**
     * Run a turn and write its events to an SSE stream.
     */
    protected function stream(AgentContext $context, Server $server, ?AiPendingAction $resuming = null): StreamedResponse
    {
        $runner = $this->runner;
        $budget = $this->budget;
        $userId = $context->user->id;
        $serverUuid = $server->uuid;
        $turnId = $context->turnId;
        $conversationId = $context->conversationId;
        $model = $this->factory->model(ProviderFactory::TASK_AGENT);

        return response()->stream(function () use ($runner, $context, $resuming, $userId, $serverUuid, $turnId, $conversationId, $model) {
            // A turn legitimately runs for minutes; the client disconnecting
            // must not abort a tool call halfway through.
            set_time_limit(0);
            ignore_user_abort(true);

            // Flush a comment immediately so proxies do not 504 while the model
            // is still thinking or the turn is queued.
            $this->write(': keep-alive');

            $startedAt = microtime(true);
            $status = 'success';
            $error = null;
            $toolCalls = 0;

            try {
                if ($resuming !== null) {
                    $this->resumeApprovedCall($runner, $context, $resuming);
                }

                $runner->run($context, function (AgentEvent $event) use (&$toolCalls) {
                    if ($event->type === AgentEvent::TYPE_TOOL_CALL) {
                        ++$toolCalls;
                    }

                    $this->write('data: ' . json_encode($event->toArray()));
                });
            } catch (\Throwable $e) {
                $status = 'error';
                $error = $e->getMessage();
                Log::error('AI agent stream failed for user ' . $userId . ': ' . $e->getMessage());
                $this->write('data: ' . json_encode(AgentEvent::error('The AI ran into a problem. Please try again.')->toArray()));
            }

            $this->write('data: [DONE]');

            try {
                AiUsageLog::create([
                    'user_id' => $userId,
                    'server_uuid' => $serverUuid,
                    'conversation_id' => $conversationId,
                    'turn_id' => $turnId,
                    'step' => $context->step,
                    'tool_calls_count' => $toolCalls,
                    'model' => $model ?: 'unknown',
                    'source' => 'agent',
                    'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000),
                    'status' => $status,
                    'error_message' => $error,
                ]);
            } catch (\Throwable $e) {
                Log::warning('Failed to write AI usage log: ' . $e->getMessage());
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * Run the call the user just approved, then let the loop carry on.
     */
    protected function resumeApprovedCall(AgentRunner $runner, AgentContext $context, AiPendingAction $pending): void
    {
        if ($pending->status !== AiPendingAction::STATUS_APPROVED) {
            return;
        }

        $definition = $this->registry->find($pending->tool_name);

        if ($definition === null || !$this->registry->userCanUse($context->user, $context->server, $definition)) {
            $context->push(AiMessage::tool(
                'approved',
                $pending->tool_name,
                json_encode(['ok' => false, 'error' => 'unavailable', 'message' => 'That tool is no longer available.']),
                true,
            ));

            return;
        }

        // Re-resolve the tier rather than trusting the stored one: an operator
        // may have hardened the tool while the approval was outstanding.
        $risk = $this->riskGate->resolve($definition, $pending->arguments);

        $call = new \Everest\Services\AI\Data\AiToolCall('approved', $definition->name, $pending->arguments);
        $result = $runner->runTool($context, $call, $definition, $pending->arguments, $risk);

        $this->write('data: ' . json_encode(
            AgentEvent::toolResult('approved', $definition->name, $result->ok, $result->summary())->toArray()
        ));

        $context->push(AiMessage::tool('approved', $definition->name, $result->toModelPayload(), !$result->ok));

        AiToolCall::where('turn_id', $pending->turn_id)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->update(['status' => AiToolCall::STATUS_APPROVED, 'resolved_at' => now()]);
    }

    /**
     * Write one SSE frame.
     *
     * `ob_flush()` emits a notice when no buffer is active, which would land
     * as garbage in the middle of the stream — hence the level check.
     */
    protected function write(string $line): void
    {
        echo $line . "\n\n";

        if (ob_get_level() > 0) {
            @ob_flush();
        }

        flush();
    }

    /**
     * @return AiMessage[]
     */
    protected function buildHistory(Request $request): array
    {
        $messages = [];

        foreach (array_slice((array) $request->input('messages', []), -10) as $entry) {
            if (!is_array($entry) || !isset($entry['role'], $entry['content'])) {
                continue;
            }

            if (!in_array($entry['role'], [AiMessage::ROLE_USER, AiMessage::ROLE_ASSISTANT], true)) {
                continue;
            }

            $messages[] = new AiMessage($entry['role'], (string) $entry['content']);
        }

        $messages[] = AiMessage::user((string) $request->input('query'));

        return $messages;
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
