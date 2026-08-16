<?php

namespace Everest\Http\Controllers\Api\Concerns;

use Everest\Models\Server;
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
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Agent\AssistAuthorizer;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;

/**
 * Running an agent turn over SSE, and resuming one that suspended.
 *
 * Shared between the server assistant and the admin assistant because the hard
 * parts are identical and were expensive to get right: answering a suspended
 * call with the id the model actually issued, closing the sibling calls a
 * suspension stranded, and re-checking authorization on resume rather than
 * trusting what was stored. Every one of those was a live bug at some point. A
 * second copy would be a second place for the next one to hide.
 *
 * The using class supplies its own dependencies through the accessors below;
 * the two controllers sit in different hierarchies (client versus application
 * API), so a shared base class is not available.
 */
trait HandlesAgentTurns
{
    abstract protected function agentRunner(): AgentRunner;

    abstract protected function toolRegistry(): ToolRegistry;

    abstract protected function toolRiskGate(): RiskGate;

    abstract protected function turnRecorder(): TurnRecorder;

    abstract protected function providerFactory(): ProviderFactory;

    /**
     * Run a turn and write its events to an SSE stream.
     */
    protected function streamTurn(
        AgentContext $context,
        ?AiPendingAction $resuming = null,
        ?AiConversation $conversation = null,
    ): StreamedResponse {
        $runner = $this->agentRunner();
        $recorder = $this->turnRecorder();
        $userId = $context->user->id;
        $serverUuid = $context->server?->uuid;
        $turnId = $context->turnId;
        $conversationId = $context->conversationId;
        $model = $this->providerFactory()->model(ProviderFactory::TASK_AGENT);

        return response()->stream(function () use ($runner, $recorder, $context, $resuming, $conversation, $userId, $serverUuid, $turnId, $conversationId, $model) {
            // A turn legitimately runs for minutes; the client disconnecting
            // must not abort a tool call halfway through.
            set_time_limit(0);
            ignore_user_abort(true);

            // Flush a comment immediately so proxies do not 504 while the model
            // is still thinking or the turn is queued.
            $this->write(': keep-alive');

            if ($conversation !== null) {
                $this->write('data: ' . json_encode(
                    AgentEvent::conversation($conversation->id, (string) $conversation->title)->toArray()
                ));
            }

            // Re-announced at the top of every turn that carries one, so the
            // banner naming the customer's server is on screen before the first
            // token arrives rather than only on the turn that opened it.
            if ($context->assist !== null && $context->targetServer() !== null) {
                $this->write('data: ' . json_encode(AgentEvent::assist(
                    $context->assist->serverUuid,
                    $context->assist->serverName,
                    $context->assist->writable,
                    $context->assist->reason,
                )->toArray()));
            }

            $startedAt = microtime(true);
            $status = 'success';
            $error = null;
            $toolCalls = 0;

            try {
                if ($resuming !== null) {
                    $this->resumeSuspendedCall($runner, $context, $resuming);
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

            // Rolls the conversation's expiry forward the same way a manual
            // append does, so an active chat is not reaped mid-use, and banks
            // the turn's redaction tokens and assist session against the
            // conversation so neither has to be re-established on the next turn.
            $recorder->touch($conversation, $context);

            try {
                AiUsageLog::create([
                    'user_id' => $userId,
                    'server_uuid' => $serverUuid,
                    'conversation_id' => $conversationId,
                    'turn_id' => $turnId,
                    'step' => $context->step,
                    'tool_calls_count' => $toolCalls,
                    'model' => $model ?: 'unknown',
                    'source' => $serverUuid === null ? 'admin-agent' : 'agent',
                    // Summed across every model call the turn made, not just
                    // the last one. Without these the monthly token budget has
                    // nothing to count on precisely the workload that spends
                    // the most — an agent turn is many calls, a chat is one.
                    'prompt_tokens' => $context->usage['prompt_tokens'],
                    'completion_tokens' => $context->usage['completion_tokens'],
                    'total_tokens' => $context->usage['total_tokens'],
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
     * Rebuild a suspended turn.
     *
     * The recorder is attached only after the stored messages are restored, so
     * resuming replays the earlier half into the model without writing it to
     * the transcript a second time.
     */
    protected function restoreTurn(AiPendingAction $pending, $user, ?Server $server): AgentContext
    {
        $context = AgentContext::fromState(
            $user,
            $server,
            $pending->turn_id,
            $pending->conversation_id,
            $pending->state,
        )->withRecorder($this->turnRecorder());

        $this->restoreAssist($context);

        return $context;
    }

    /**
     * Re-attach an assist session to its server, or drop it.
     *
     * `fromState()` deliberately rebuilds a binding without its server, leaving
     * it inert. This is where it becomes real again — and it becomes real only
     * if the server still exists and the administrator still holds
     * `servers.assist`. Neither answer is read from the stored blob, because the
     * blob was written before the administrator went to lunch and their Access
     * Profile may have been narrowed while the approval sat on screen.
     *
     * A binding that fails either check is simply dropped: the turn resumes on
     * the admin surface with no access to the customer's server, which is what
     * an administrator without the capability should have had all along.
     */
    protected function restoreAssist(AgentContext $context): void
    {
        $binding = $context->assist;

        if ($binding === null || $context->pendingAssistUuid() === null) {
            return;
        }

        $authorizer = app(AssistAuthorizer::class);
        $server = $authorizer->reauthorize($context->user, $binding);

        if ($server === null) {
            $context->assist = null;

            return;
        }

        $context->bindAssist($binding, $server);
    }

    /**
     * Feed the user's answer back and let the loop carry on.
     *
     * The answer is validated against the options as they were *persisted*, not
     * as the client reports them — the client could otherwise write anything
     * into the transcript the model reads next.
     */
    protected function applyAnswer(AiPendingAction $pending, AgentContext $context, string $answer): void
    {
        $arguments = (array) $pending->arguments;
        $options = SharedTools::normaliseOptions($arguments['options'] ?? []);
        $labels = array_column($options, 'label');
        $allowOther = (bool) ($arguments['allow_other'] ?? false);

        $answer = trim($answer);
        $matched = null;

        foreach ($labels as $label) {
            if (strcasecmp($label, $answer) === 0) {
                $matched = $label;
                break;
            }
        }

        if ($matched === null && !$allowOther) {
            abort(422, 'Choose one of the answers offered.');
        }

        $pending->update(['status' => AiPendingAction::STATUS_APPROVED]);

        $context->push(
            AiMessage::tool(
                $this->resolveToolCallId($pending, $context),
                SharedTools::ASK_USER,
                json_encode(['ok' => true, 'answer' => $matched ?? $answer]),
            ),
            TurnRecorder::toolDisplay(true, $matched ?? $answer),
        );

        $this->closeUnresolvedCalls($context);
    }

    /**
     * Run the call the user just approved, then let the loop carry on.
     */
    protected function resumeSuspendedCall(AgentRunner $runner, AgentContext $context, AiPendingAction $pending): void
    {
        if ($pending->status !== AiPendingAction::STATUS_APPROVED) {
            return;
        }

        // A question was already answered into the transcript by applyAnswer();
        // there is nothing to execute.
        if ($pending->tool_name === SharedTools::ASK_USER) {
            return;
        }

        $definition = $this->toolRegistry()->find($pending->tool_name);
        $callId = $this->resolveToolCallId($pending, $context);

        if ($definition === null || !$this->stillUsable($context, $definition)) {
            $context->push(
                AiMessage::tool(
                    $callId,
                    $pending->tool_name,
                    json_encode(['ok' => false, 'error' => 'unavailable', 'message' => 'That tool is no longer available.']),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'No longer available'),
            );
            $this->closeUnresolvedCalls($context);

            return;
        }

        // Re-resolve the tier rather than trusting the stored one: an operator
        // may have hardened the tool while the approval was outstanding.
        $risk = $this->toolRiskGate()->resolve($definition, $pending->arguments);

        $call = new ToolCallData($callId, $definition->name, $pending->arguments);
        $emit = fn (AgentEvent $event) => $this->write('data: ' . json_encode($event->toArray()));

        $startedAt = microtime(true);
        $result = $definition->hostHandled
            // The *stored* tier, not the freshly resolved one. For a batch this
            // is the ceiling none of its calls may exceed, and the only record of
            // what the user actually agreed to — re-resolving it would ask the
            // wrong question, since `batch` declares SAFE and is priced by what
            // is inside it.
            ? $runner->runHostTool($context, $call, $definition, $pending->arguments, $emit, (string) $pending->risk)
            : $runner->runTool($context, $call, $definition, $pending->arguments, $risk);

        $fresh = $context->redactions->drainFresh();
        if ($fresh !== []) {
            $emit(AgentEvent::redaction($fresh));
        }

        $emit(AgentEvent::toolResult(
            $callId,
            $definition->name,
            $result->ok,
            $result->summary(),
            $result->ok ? $result->data : null,
            (int) round((microtime(true) - $startedAt) * 1000),
        ));

        $context->push(
            AiMessage::tool($callId, $definition->name, $result->toModelPayload(), !$result->ok),
            TurnRecorder::toolDisplay($result->ok, $result->summary()),
        );

        $this->closeUnresolvedCalls($context);

        AiToolCall::where('turn_id', $pending->turn_id)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->update(['status' => AiToolCall::STATUS_APPROVED, 'resolved_at' => now()]);
    }

    /**
     * Whether an approved call may still run.
     *
     * Delegated to the runner, which asks the same question of every call inside
     * an approved batch. `restoreAssist()` has already re-checked the capability
     * behind any binding by the time this is reached, so a binding present here
     * is one that has just been re-authorized.
     */
    protected function stillUsable(AgentContext $context, $definition): bool
    {
        return $this->agentRunner()->usable($context, $definition);
    }

    /**
     * Resume the turn with a refusal fed back as the tool result, so the model
     * can offer an alternative instead of the conversation dead-ending.
     */
    protected function applyRejection(AiPendingAction $pending, AgentContext $context): void
    {
        $pending->update(['status' => AiPendingAction::STATUS_REJECTED]);

        AiToolCall::where('turn_id', $pending->turn_id)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->update(['status' => AiToolCall::STATUS_REJECTED, 'resolved_at' => now()]);

        $declined = $pending->tool_name === SharedTools::ASK_USER
            ? 'The user dismissed the question without answering. Carry on without that detail, or say what you need.'
            : 'The user declined this action. Do not retry it; suggest an alternative or ask what they would prefer.';

        $context->push(
            AiMessage::tool(
                $this->resolveToolCallId($pending, $context),
                $pending->tool_name,
                json_encode(['ok' => false, 'error' => 'declined_by_user', 'message' => $declined]),
                true,
            ),
            TurnRecorder::toolDisplay(false, 'Declined by you'),
        );

        $this->closeUnresolvedCalls($context);
    }

    /**
     * The id the model used when it asked for this call.
     *
     * It has to be echoed back verbatim: a tool result is matched to its call
     * by id, and an id the model never issued is rejected outright. Rows
     * suspended before the id was persisted fall back to the stored turn state,
     * which still carries the assistant message that made the request.
     */
    protected function resolveToolCallId(AiPendingAction $pending, AgentContext $context): string
    {
        if (is_string($pending->tool_call_id) && $pending->tool_call_id !== '') {
            return $pending->tool_call_id;
        }

        foreach ($context->unresolvedToolCalls() as $call) {
            if ($call->name === $pending->tool_name) {
                return $call->id;
            }
        }

        // Nothing to match against — the turn cannot be continued coherently,
        // but a synthetic id at least keeps the shape valid.
        return 'call_' . substr($pending->turn_id, 0, 8);
    }

    /**
     * Answer any sibling calls the suspension left hanging.
     *
     * The model can ask for several tools at once. If one of them needed
     * approval, the calls queued behind it never ran — and a request whose tool
     * calls are not all answered is rejected. Telling the model they were
     * skipped is both valid and useful: it can simply ask again.
     */
    protected function closeUnresolvedCalls(AgentContext $context): void
    {
        foreach ($context->unresolvedToolCalls() as $call) {
            $context->push(
                AiMessage::tool(
                    $call->id,
                    $call->name,
                    json_encode([
                        'ok' => false,
                        'error' => 'not_executed',
                        'message' => 'This call was not run because the turn paused for approval. Request it again if you still need it.',
                    ]),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'Skipped'),
            );
        }
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
}
