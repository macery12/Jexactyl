<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Setting;
use Everest\Facades\LogBatch;
use Everest\Models\AiToolCall;
use Everest\Models\AiPendingAction;
use Everest\Models\AiToolDiscovery;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Tools\ToolExecutor;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\ToolInvocation;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\ToolCallSalvager;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;

/**
 * Drives one agent turn: model call, tool calls, repeat.
 *
 * The loop is bounded four ways — steps, wall clock, the inference gate's lease,
 * and repetition — because an agent that misjudges a task can otherwise spend a
 * GPU indefinitely. It ends when the model stops asking for tools, when a bound
 * is hit, or when it needs a human decision, which suspends rather than blocks.
 *
 * What the model is offered each step is a *working set*, not the catalogue.
 * `WorkingSetPlanner` builds it in priority order and `search_tools` is how the
 * model reaches everything else. The runner's job in all of that is narrow: keep
 * the offered set and the executable set the same thing. A call is runnable only
 * if it is in this step's offered list, and that check has not moved.
 */
class AgentRunner
{
    public function __construct(
        private ProviderFactory $factory,
        private InferenceGate $gate,
        private ToolRegistry $registry,
        private ToolExecutor $executor,
        private RiskGate $riskGate,
        private ToolCallSalvager $salvager,
        private SystemPromptBuilder $promptBuilder,
        private PiiRedactor $redactor,
        private AssistAuthorizer $assist,
        private DaemonFileRepository $files,
        private TurnCancellations $cancellations,
        private WorkingSetPlanner $planner,
        private ToolDiscoveryService $discovery,
        private PrerequisiteResolver $prerequisites,
        private ProgressGuard $progress,
        private DiscoveryRecorder $discoveryLog,
        private ToolBudget $budget,
    ) {
    }

    /**
     * When the turn's authority was last re-derived.
     *
     * Per-runner rather than per-context because it is a rate limit on a query,
     * not a fact about the turn, and the runner is resolved once per turn.
     */
    private ?float $authorityCheckedAt = null;

    /**
     * Run a turn, emitting events as it goes.
     *
     * The inference slot is not acquired here. Admission is the caller's
     * business now: a turn that cannot have a slot is handed a queue ticket and
     * the request ends, rather than a PHP worker being parked on a sleep loop
     * until one frees up. By the time this is reached the slot is already held.
     *
     * @param callable(AgentEvent): void $emit
     */
    public function run(AgentContext $context, callable $emit): void
    {
        $startedAt = $this->now();
        $this->beginDeadline($context, $startedAt);

        try {
            // One batch id across the turn, so every activity row a tool
            // produces traces back to the conversation that caused it.
            LogBatch::start();

            // Before the first inference, not after it. A user who typed a tool's
            // registered name has already done the retrieval; making the model
            // spend a step rediscovering it is the most annoying failure this
            // whole mechanism can produce, and it costs nothing to avoid.
            $this->discovery->pinNamedTools($context, $this->lastUserMessage($context));

            $this->loop($context, $emit, $startedAt);
        } catch (\Throwable $e) {
            Log::error('AI agent turn failed: ' . $e->getMessage(), ['turn' => $context->turnId]);

            // Finalization belongs to the stream owner. Swallowing here made
            // the controller mark usage and an approved pending action as
            // successful even though the only terminal event was an error.
            throw $e;
        } finally {
            LogBatch::end();

            $elapsed = (int) round(($this->now() - $startedAt) * 1000);
            $this->gate->recordTurnDuration($elapsed);
        }
    }

    /**
     * The text of the most recent thing the user actually said.
     *
     * Walked backwards rather than tracked, because a resumed turn re-enters here
     * with the same transcript and no new user message — and re-scanning the one
     * that started it is harmless. Pinning is idempotent.
     */
    protected function lastUserMessage(AgentContext $context): string
    {
        foreach (array_reverse($context->messages) as $message) {
            if ($message->role === AiMessage::ROLE_USER) {
                return (string) $message->content;
            }
        }

        return '';
    }

    /**
     * Establish the one deadline shared by approved execution, queueing and
     * every subsequent model/tool operation in this request phase.
     */
    public function beginDeadline(AgentContext $context, ?float $startedAt = null): float
    {
        return $context->deadline ??= ($startedAt ?? $this->now()) + $this->maxWallSeconds();
    }

    /**
     * @param callable(AgentEvent): void $emit
     */
    protected function loop(AgentContext $context, callable $emit, float $startedAt): void
    {
        $maxSteps = $this->maxSteps();
        $deadline = $this->beginDeadline($context, $startedAt);

        while ($context->step < $maxSteps) {
            if ($this->stopRequested($context)) {
                $emit(AgentEvent::done($context->revoked ? 'revoked' : 'cancelled'));

                return;
            }

            if ($this->now() >= $deadline) {
                $emit(AgentEvent::done('time_limit'));

                return;
            }

            ++$context->step;
            $emit(AgentEvent::step($context->step, $maxSteps));

            $set = $this->offerings($context);
            $definitions = $set->definitions;
            $tools = $this->registry->toAiTools($definitions);

            if (!$this->hasTime($context)) {
                $emit(AgentEvent::done('time_limit'));

                return;
            }

            $response = $this->callModel($context, $tools, $emit);

            $calls = $response['calls'];
            $text = $response['text'];
            $reasoning = $response['reasoning'];

            if (count($calls) > $this->maxCallsPerResponse()) {
                Log::warning('AI agent response exceeded the per-response tool-call cap.', [
                    'turn' => $context->turnId,
                    'received' => count($calls),
                    'cap' => $this->maxCallsPerResponse(),
                ]);
                $calls = array_slice($calls, 0, $this->maxCallsPerResponse());
            }

            // Nothing structured came back. If the text looks like a botched
            // call, spend a repair round under a schema-constrained grammar
            // rather than throwing away the step.
            $repaired = false;

            if ($calls === [] && $this->shouldRepair($context, $text)) {
                ++$context->repairs;
                $repaired = true;
                $calls = $this->repair($context, $tools, $text);
            }

            if ($calls === []) {
                // A repair that produced nothing means `$text` is the malformed
                // call that triggered it — `looksLikeAttempt()` said so. Pushing
                // it as the answer would put a wall of half-written JSON on the
                // user's screen labelled as a completed turn, which is exactly
                // the failure mode of the small local models the salvager exists
                // for. Better to say what happened.
                if ($repaired) {
                    Log::warning('AI agent turn abandoned: unrepairable tool call', [
                        'turn' => $context->turnId,
                        'step' => $context->step,
                    ]);

                    throw new AIServiceException('The model tried to use a tool but could not write the request correctly. This usually means the model is too small for the number of tools it was offered — try again, or ask an administrator to lower the tool limit.');
                }

                $context->push(AiMessage::assistant($text));
                $emit(AgentEvent::done('complete'));

                return;
            }

            // The reasoning rides with the calls it produced. Anthropic verifies
            // that pairing on the next request and rejects the turn if the
            // thinking that led to a tool call has gone missing.
            $context->push(AiMessage::assistant($text !== '' ? $text : null, $calls, $reasoning));

            foreach ($calls as $call) {
                // Between calls, never inside one. A model can ask for several
                // tools at once, and a stop arriving after the second of five
                // must not run the other three.
                if ($this->stopRequested($context)) {
                    $this->answerUnrunCalls($context);
                    $emit(AgentEvent::done($context->revoked ? 'revoked' : 'cancelled'));

                    return;
                }

                $outcome = $this->handleCall($context, $call, $definitions, $emit);

                if ($outcome === 'suspended') {
                    return;
                }
            }
        }

        $emit(AgentEvent::done('step_limit'));
    }

    /**
     * Whether this turn should stop at the boundary it has just reached.
     *
     * Two reasons, deliberately answered by one question. The user asked it to
     * stop, or the authority it runs under stopped being valid — a durable turn
     * outlives its request, so "is this person still signed in" is no longer
     * something the request answered on the way in. Both end the turn the same
     * clean way: nothing is half-done at a boundary, and the caller answers the
     * calls the stop left unrun so the transcript stays one a provider accepts.
     *
     * Latched on the context the first time it is true, so every later
     * checkpoint agrees without asking again, and so the stream owner can tell a
     * stopped turn from a completed one after the loop has returned.
     */
    protected function stopRequested(AgentContext $context): bool
    {
        if ($context->cancelled) {
            return true;
        }

        if ($this->cancellations->requested($context->turnId)) {
            return $context->cancelled = true;
        }

        if (!$this->authorityHeld($context)) {
            $context->revoked = true;

            return $context->cancelled = true;
        }

        return false;
    }

    /**
     * Whether the turn's authority is still in force.
     *
     * Rate limited rather than asked at every checkpoint. `stopRequested()` is
     * called between steps *and* before each call in a multi-call response *and*
     * between the children of a batch, so an unthrottled check would put two
     * indexed queries between every child of a twenty-call batch to answer a
     * question whose answer changes at human speed. The interval is the honest
     * cost of "at the next boundary": a revocation lands within it, and within
     * it nothing has escalated — the authority was valid when the step began.
     */
    protected function authorityHeld(AgentContext $context): bool
    {
        if ($context->authorityCheck === null) {
            return true;
        }

        $now = $this->now();

        if ($this->authorityCheckedAt !== null && ($now - $this->authorityCheckedAt) < self::AUTHORITY_RECHECK_SECONDS) {
            return true;
        }

        $this->authorityCheckedAt = $now;

        return ($context->authorityCheck)();
    }

    /**
     * Answer the calls a stop left unrun.
     *
     * The assistant message carrying them has already been pushed — and, with a
     * recorder attached, already written to the transcript. A request whose tool
     * calls are not all answered is one every provider rejects, so leaving them
     * open would make the *next* turn fail on a conversation that only stopped.
     */
    protected function answerUnrunCalls(AgentContext $context): void
    {
        foreach ($context->unresolvedToolCalls() as $call) {
            $context->push(
                AiMessage::tool(
                    $call->id,
                    $call->name,
                    json_encode([
                        'ok' => false,
                        'error' => 'cancelled',
                        'message' => 'The user stopped this turn before the call ran.',
                    ]),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'Stopped by you'),
            );
        }
    }

    /**
     * The working set for this step.
     *
     * All the surface-specific reasoning that used to live here — which groups
     * count as active, how an assist session narrows the admin catalogue, what
     * fits — has moved to `WorkingSetPlanner`, which is the only thing that needs
     * to hold all of it at once. What is left is the part the runner owns: ask
     * for a set, and log what was offered.
     */
    protected function offerings(AgentContext $context): WorkingSet
    {
        // Recomputed rather than trusted. An assist session can be dropped
        // between steps by `AssistAuthorizer::reauthorize()`, and a phase that
        // outlived its binding would keep offering a customer's server tools.
        $context->phase = $context->resolvePhase();

        $set = $this->planner->plan($context, $this->maxTools());

        $this->discoveryLog->offer(
            $context,
            $set,
            count($this->planner->catalogue($context)),
            $this->maxTools(),
            $this->budget->profile(),
        );

        return $set;
    }

    /**
     * One model call. Text and reasoning stream straight through; tool calls
     * are collected.
     *
     * @param AiTool[] $tools
     * @param callable(AgentEvent): void $emit
     *
     * @return array{text: string, calls: ToolCallData[], reasoning: array<int, array>}
     */
    protected function callModel(AgentContext $context, array $tools, callable $emit): array
    {
        $provider = $this->factory->make(ProviderFactory::TASK_AGENT, $this->remainingSeconds($context));

        $request = (new AiRequest(
            messages: $context->messages,
            // The offered set is passed because two of the prompt's sections are
            // about tools that may not be on the table this step — the group
            // meta-tool and `ask_user`. Built without it they return null, which
            // silently drops the guidance on every step but a repair.
            systemPrompt: $this->promptBuilder->build($context, $tools),
            tools: $tools,
            // Tool selection benefits from determinism far more than prose
            // does; the configured temperature applies to the final answer.
            temperature: $tools !== [] ? 0.0 : null,
        ))->withReasoning($this->reasoningEnabled());

        // The prompt mints tokens of its own — a server whose name is an email
        // address, say — and they are minted before a single token of the answer
        // arrives. Draining here means the browser can already resolve them by
        // the time the model refers to one.
        $this->emitRedactions($context, $emit);

        $text = '';
        $calls = [];
        $reasoning = [];

        foreach ($provider->stream($request) as $event) {
            switch ($event->type) {
                case AiStreamEvent::TYPE_TEXT:
                    $text .= (string) $event->text;
                    $emit(AgentEvent::text((string) $event->text));
                    break;

                case AiStreamEvent::TYPE_REASONING:
                    $emit(AgentEvent::reasoning((string) $event->text));
                    break;

                case AiStreamEvent::TYPE_REASONING_BLOCK:
                    $reasoning[] = $event->reasoningBlock;
                    break;

                    // Named but not yet fully written. Announced so the UI can say
                    // what is coming while the arguments are still arriving.
                case AiStreamEvent::TYPE_TOOL_CALL_START:
                    if ($event->toolCall !== null) {
                        $emit(AgentEvent::toolPending($event->toolCall->id, $event->toolCall->name));
                    }
                    break;

                case AiStreamEvent::TYPE_TOOL_CALL:
                    if ($event->toolCall !== null) {
                        $calls[] = $event->toolCall;
                    }
                    break;

                    // Every step reports its own cost and the turn is the unit
                    // anyone is billed in, so it accumulates on the context
                    // rather than being read off the last call — which would
                    // report a twelve-step turn as costing whatever step twelve
                    // happened to cost.
                case AiStreamEvent::TYPE_USAGE:
                    $context->addUsage($event->usage);
                    break;

                case AiStreamEvent::TYPE_ERROR:
                    throw new AIServiceException((string) $event->error);
            }
        }

        return ['text' => $text, 'calls' => $calls, 'reasoning' => $reasoning];
    }

    /**
     * Ask again under a JSON-schema grammar, which on a local model makes
     * schema-valid output the only thing the sampler can emit.
     *
     * @param AiTool[] $tools
     *
     * @return ToolCallData[]
     */
    protected function repair(AgentContext $context, array $tools, string $text): array
    {
        // First try to read what it already wrote — a correctly-formed call in
        // the wrong channel needs no second inference at all.
        $salvaged = $this->salvager->salvage($text, $tools);
        if ($salvaged !== []) {
            return $salvaged;
        }

        try {
            if (!$this->hasTime($context)) {
                return [];
            }

            $provider = $this->factory->make(ProviderFactory::TASK_AGENT, $this->remainingSeconds($context));

            $request = (new AiRequest(
                messages: array_merge($context->messages, [
                    AiMessage::assistant($text),
                    AiMessage::user('That was not a valid tool call. Reply with only the JSON object for the tool you want to call.'),
                ]),
                systemPrompt: $this->promptBuilder->build($context, $tools),
                tools: $tools,
                temperature: 0.0,
            ))->withResponseSchema($this->salvager->repairSchema($tools));

            $repaired = '';
            foreach ($provider->stream($request) as $event) {
                if ($event->type === AiStreamEvent::TYPE_TEXT) {
                    $repaired .= (string) $event->text;
                } elseif ($event->type === AiStreamEvent::TYPE_USAGE) {
                    // A repair is a second inference on the whole transcript,
                    // which is the most expensive thing a step can do. Charging
                    // it is the only way the cost of a model that keeps
                    // malforming its calls is ever visible.
                    $context->addUsage($event->usage);
                } elseif ($event->type === AiStreamEvent::TYPE_TOOL_CALL && $event->toolCall !== null) {
                    return [$event->toolCall];
                }
            }

            return $this->salvager->salvage($repaired, $tools);
        } catch (\Throwable $e) {
            Log::warning('AI tool-call repair failed: ' . $e->getMessage());

            return [];
        }
    }

    protected function shouldRepair(AgentContext $context, string $text): bool
    {
        return $context->repairs < $this->maxRepairs() && $this->salvager->looksLikeAttempt($text);
    }

    /**
     * Validate, gate and run one call. Returns 'suspended' when the turn has
     * stopped to wait for a human.
     *
     * @param ToolDefinition[] $definitions
     * @param callable(AgentEvent): void $emit
     */
    protected function handleCall(AgentContext $context, ToolCallData $call, array $definitions, callable $emit): string
    {
        if (!$this->hasTime($context)) {
            $this->pushToolResult($context, $call, ToolResult::error(
                'time_limit',
                'The turn deadline was reached before this tool could start.'
            ));

            return 'continued';
        }

        $definition = $this->registry->find($call->name);

        // Only tools offered this step are runnable. A name that resolves in the
        // registry but was filtered out for this user must not slip through on a
        // hallucinated call. This check has not moved and does not move: it is
        // the boundary, and retrieval only decides what is on the list it reads.
        $offered = false;
        foreach ($definitions as $candidate) {
            if ($candidate->name === $call->name) {
                $offered = true;
                break;
            }
        }

        if ($definition === null || !$offered) {
            $this->pushToolResult($context, $call, $this->unofferedCall($context, $call, $definition));

            return 'continued';
        }

        $validation = $this->registry->validate($definition, $call->arguments);
        if (!$validation['valid']) {
            // Fed back as a tool result rather than thrown: the model can fix
            // its own arguments on the next step.
            $this->pushToolResult($context, $call, ToolResult::error(
                'invalid_arguments',
                implode(' ', $validation['errors']),
                retryable: true,
            ));

            return 'continued';
        }

        $arguments = $validation['value'];

        // `ask_user` is a suspension in its own right — asking *is* the pause —
        // so it is handled before the risk gate rather than through it. Every
        // other host-handled tool goes through the gate like anything else: they
        // touch no endpoint, but opening somebody else's server is exactly the
        // kind of act an approval card exists for.
        if ($definition->hostHandled && $definition->name === SharedTools::ASK_USER) {
            return $this->handleQuestion($context, $call, $arguments, $emit);
        }

        if ($definition->name === SharedTools::BATCH) {
            $plan = $this->planBatch($arguments, $definitions);

            // A batch that cannot run whole never reaches the card. See
            // `planBatch()` — this is the branch that keeps the card honest.
            if ($plan instanceof ToolResult) {
                $this->pushToolResult($context, $call, $plan);

                return 'continued';
            }

            [$arguments, $risk] = $plan;

            foreach ($arguments['calls'] as $child) {
                $childDefinition = $this->registry->find($child['tool']);
                if ($childDefinition !== null) {
                    $risk = $this->riskGate->max(
                        $risk,
                        $this->riskForContext($context, $childDefinition, $child['arguments']),
                    );
                }
            }
        } else {
            $risk = $this->riskForContext($context, $definition, $arguments);
        }

        $emit(AgentEvent::toolCall($call->id, $definition->name, $arguments, $risk));

        if (!$this->riskGate->runsAutomatically($risk)) {
            $this->suspend($context, $call, $definition, $arguments, $risk, $emit);

            return 'suspended';
        }

        $startedAt = microtime(true);
        $result = $definition->hostHandled
            ? $this->runHostTool($context, $call, $definition, $arguments, $emit, $risk)
            : $this->runTool($context, $call, $definition, $arguments, $risk);

        $this->emitRedactions($context, $emit);

        $emit(AgentEvent::toolResult(
            $call->id,
            $definition->name,
            $result->ok,
            $result->summary(),
            // The shaped payload, exactly as the model received it. Sent live so
            // a claim in the answer can be checked against its evidence; not
            // stored, because the transcript is not an audit of panel state.
            $result->ok || $result->isBatch() ? $result->data : null,
            (int) round((microtime(true) - $startedAt) * 1000),
            $result->outcome,
        ));

        // A mutation moves the world, so an identical call after it is a
        // different call. Bumped before the guard sees this one, on the tool's
        // declared tier rather than on whether it happened to succeed — a failed
        // write can still have changed something.
        if ($result->ok && $risk !== ToolDefinition::RISK_SAFE) {
            $this->progress->stateChanged($context);
        }

        $verdict = $this->progress->evaluate($context, $definition->name, $arguments, $result);

        // The real result is still emitted above — the user sees what came back —
        // and only the model's copy is replaced. Feeding it the same payload a
        // third time is what it has already twice failed to act on.
        $this->pushToolResult($context, $call, $verdict['result']);

        $this->releasePin($context, $definition, $result);

        if ($verdict['halt']) {
            $context->push(AiMessage::assistant(
                'I stopped because I was repeating the same step without getting anywhere.'
            ));
            $emit(AgentEvent::done('no_progress'));

            return 'suspended';
        }

        return 'continued';
    }

    /**
     * Let go of a pin whose work is done.
     *
     * A pin that never releases is a slow leak: by step eight a small budget is
     * full of tools the turn finished with four steps ago, and the tool it
     * actually needs next has nowhere to go. Released only on success, and only
     * for reads — a write that succeeded may still be part of a sequence, and a
     * read that failed is one the model is likely to retry.
     *
     * A gateway is never released this way. `admin_assist_server` succeeding is
     * the moment the session exists, which is exactly when the tools behind it
     * become reachable; dropping it there would undo the transition it just made.
     */
    protected function releasePin(AgentContext $context, ToolDefinition $definition, ToolResult $result): void
    {
        if (!$result->ok || !$definition->isRead()) {
            return;
        }

        if (in_array($definition->name, WorkingSet::RESERVED[$context->phase] ?? [], true)) {
            return;
        }

        $context->unpin($definition->name);
    }

    /**
     * Explain a call for a tool that was not on this step's list.
     *
     * This used to be one message — "there is no tool called X" — for four
     * genuinely different situations, and it was the wrong message for three of
     * them. A model told a tool does not exist stops trying; told it exists but
     * needs a session, it opens one. So the cases are separated, and the most
     * common of them is *recovered from* rather than merely reported:
     *
     * A permitted, enabled tool the model reached for from memory is **pinned and
     * the model told to try again**. Loading is not executing — the permission
     * check happened a line above, the tool still has to pass validation, and a
     * write still stops at its approval card — so the only thing this skips is a
     * round trip through `search_tools` for a name the model already had right.
     * That is the single most common retrieval failure and the cheapest to undo.
     *
     * What it does not do is trust the model's memory as authority. A name that
     * resolves but is not permitted, or that an operator disabled, is refused
     * here and stays refused; nothing about being remembered makes it reachable.
     */
    protected function unofferedCall(AgentContext $context, ToolCallData $call, ?ToolDefinition $definition): ToolResult
    {
        if ($definition === null) {
            $this->discoveryLog->unreachable(
                $context,
                $call->name,
                AiToolDiscovery::EVENT_UNAVAILABLE,
                'Called a name that is not registered.',
            );

            return ToolResult::error(
                'tool_not_found',
                sprintf(
                    'There is no tool called "%s". Use search_tools to find what you need by description.',
                    $call->name,
                ),
                retryable: true,
            );
        }

        if ($this->registry->isDisabled($definition->name)) {
            return ToolResult::error(
                'tool_disabled',
                sprintf('%s has been turned off by an administrator. Say so and stop.', $definition->name),
            );
        }

        $callable = $this->planner->callable($context);

        if (!isset($callable[$definition->name])) {
            $unmet = $this->prerequisites->unmet($context, $definition);

            if ($unmet !== []) {
                $this->discoveryLog->unreachable(
                    $context,
                    $definition->name,
                    AiToolDiscovery::EVENT_UNAVAILABLE,
                    'Called before its prerequisite was met.',
                );

                return ToolResult::error(
                    'prerequisite_required',
                    sprintf('%s is not usable yet. %s Call %s first.', $definition->name, $unmet[0]['reason'], $unmet[0]['tool']),
                    retryable: true,
                    fields: ['requires' => $unmet],
                );
            }

            $this->discoveryLog->unreachable(
                $context,
                $definition->name,
                AiToolDiscovery::EVENT_UNAVAILABLE,
                'Called without the permission it needs.',
            );

            return ToolResult::error(
                'tool_not_permitted',
                sprintf(
                    '%s exists, but this account cannot use it here. Tell the user what permission it needs '
                        . 'rather than looking for another way round.',
                    $definition->name,
                ),
            );
        }

        // Reachable and permitted, just not loaded. Pin it and say so.
        $context->pin($definition->name, 'called before it was loaded');
        $this->discoveryLog->unreachable(
            $context,
            $definition->name,
            AiToolDiscovery::EVENT_NOT_LOADED,
            'Called before it was loaded; pinned for the next step.',
        );

        return ToolResult::error(
            'tool_not_loaded',
            sprintf('%s was not loaded yet. It is now — call it again.', $definition->name),
            retryable: true,
        );
    }

    /**
     * Hand the browser the values that were kept out of the request.
     *
     * Runs after every call rather than at the end of the turn: the tool row it
     * belongs to is on screen already, and a transcript that reads `[email_1]`
     * for ten seconds before resolving is worse than one that never did.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function emitRedactions(AgentContext $context, callable $emit): void
    {
        $fresh = $context->redactions->drainFresh();

        if ($fresh !== []) {
            $emit(AgentEvent::redaction($fresh));
        }
    }

    /**
     * Put the model's question to the user, or refuse to.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function handleQuestion(
        AgentContext $context,
        ToolCallData $call,
        array $arguments,
        callable $emit,
    ): string {
        $question = trim((string) ($arguments['question'] ?? ''));
        $options = SharedTools::normaliseOptions($arguments['options'] ?? []);

        // A question with nothing to choose between is not a question the UI can
        // render. Fed back rather than thrown so the model can rephrase.
        if ($question === '' || count($options) < 2) {
            $this->pushToolResult($context, $call, ToolResult::error(
                'invalid_arguments',
                'A question needs text and at least two distinct options. Ask again, or just answer.',
                retryable: true,
            ));

            return 'continued';
        }

        if ($context->questions >= SharedTools::MAX_QUESTIONS_PER_TURN) {
            $this->pushToolResult($context, $call, ToolResult::error(
                'question_limit',
                'You have already asked as many questions as this turn allows. Make a reasonable '
                    . 'assumption, say clearly which one you made, and carry on.',
            ));

            return 'continued';
        }

        ++$context->questions;

        $this->suspendForQuestion($context, $call, $question, $options, (bool) ($arguments['allow_other'] ?? false), $emit);

        return 'suspended';
    }

    /**
     * Resolve a tool the runner owns rather than dispatching.
     *
     * Public because the resume path runs it too: a host tool that suspended for
     * approval has to complete after the click, exactly as a dispatched one does.
     *
     * @param string $approvedRisk the tier this call was allowed to run at — freshly
     *                             resolved on the immediate path, and read off the
     *                             stored pending action on resume, which is the only
     *                             record of what the user actually agreed to. Only
     *                             the batch runner reads it, as the ceiling none of
     *                             its calls may exceed.
     * @param callable(AgentEvent): void $emit
     */
    public function runHostTool(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        array $arguments,
        callable $emit,
        string $approvedRisk = ToolDefinition::RISK_SAFE,
    ): ToolResult {
        if (!$this->hasTime($context)) {
            return ToolResult::error('time_limit', 'The turn deadline was reached before this action could start.');
        }

        $result = match ($definition->name) {
            AdminTools::ASSIST_SERVER => $this->openAssist($context, $arguments, $emit),
            AdminTools::ASSIST_ALLOW_WRITES => $this->escalateAssist($context, $arguments, $emit),
            SharedTools::BATCH => $this->runBatch($context, $call, $arguments, $approvedRisk, $emit),
            // Discovery runs here rather than being intercepted earlier, so it
            // goes through validation and the disable list like everything else.
            // An operator who turns off `search_tools` gets an agent with a fixed
            // working set, which is a coherent thing to want and would not be
            // possible if the runner special-cased it.
            SharedTools::SEARCH_TOOLS => $this->discovery->search(
                $context,
                $arguments,
                $this->maxTools(),
                $this->budget->results(),
            ),
            SharedTools::LOAD_TOOLS => $this->discovery->load($context, $arguments, $this->maxTools()),
            default => ToolResult::error(
                'tool_not_found',
                sprintf('There is no tool called "%s" available here.', $definition->name),
            ),
        };

        return $this->redact($context, $result)->capped($this->toolResultBytes());
    }

    /**
     * Bind this turn to a customer's server.
     *
     * By the time this runs the administrator has already approved it — the tool
     * is WRITE tier, so the call suspended and came back through the approval
     * card. What is left is to check that the grant is still real: the
     * capability is asked for again here rather than trusted from the offered
     * tool list, because an Access Profile can be narrowed while a card sits on
     * screen.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function openAssist(AgentContext $context, array $arguments, callable $emit): ToolResult
    {
        $grant = $context->pendingAssistGrant;
        if ($grant === null || $grant->phase !== AssistGrant::PHASE_OPEN) {
            return ToolResult::error('invalid_authority', 'The approved assist grant could not be authenticated.');
        }

        if (!$this->assist->permitted($context->user)) {
            return ToolResult::error(
                'forbidden',
                'You do not have permission to open a session on a customer\'s server. That needs the '
                    . '"servers.assist" capability. Say so and stop.',
            );
        }

        $binding = $grant->after;
        $server = $this->assist->resolveServer($binding->serverUuid);

        if ($server === null) {
            return ToolResult::error(
                'not_found',
                'No server matches that id. List the customer\'s servers and use an id from the result.',
                retryable: true,
            );
        }

        // The customer-visible audit is part of authorization, not best-effort
        // telemetry. Do not activate the binding unless this succeeds.
        $this->assist->record($context->user, $server, $binding);
        $context->bindAssist($binding, $server);

        $emit(AgentEvent::assist($server->uuid, (string) $server->name, false, $binding->reason));

        return ToolResult::ok([
            'server' => $server->name,
            'access' => 'read-only',
            'tools' => $binding->tools(),
            'note' => 'You can now read this server. Start with server_status, then look at the files '
                . 'or startup variables the symptom points at. You cannot change anything yet.',
        ]);
    }

    /**
     * Widen an open session to allow changes.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function escalateAssist(AgentContext $context, array $arguments, callable $emit): ToolResult
    {
        $grant = $context->pendingAssistGrant;
        if ($grant === null || $grant->phase !== AssistGrant::PHASE_ESCALATE) {
            return ToolResult::error('invalid_authority', 'The approved assist escalation could not be authenticated.');
        }

        $server = $context->targetServer();

        if ($context->assist === null || $server === null) {
            return ToolResult::error(
                'no_session',
                'There is no server session open to widen. Open one with ' . AdminTools::ASSIST_SERVER . ' first.',
            );
        }

        if (!$this->assist->permitted($context->user)) {
            return ToolResult::error(
                'forbidden',
                'You no longer have permission to act on this server.',
            );
        }

        if ($context->assist->writable) {
            return ToolResult::ok(['access' => 'read-write', 'note' => 'You already have write access here.']);
        }

        $reason = trim((string) ($arguments['reason'] ?? ''));
        $binding = $grant->after;

        // Keep the read-only binding in force until the escalation is visible
        // in the customer's activity feed.
        $this->assist->record($context->user, $server, $binding, escalation: true);
        $context->bindAssist($binding, $server);

        $emit(AgentEvent::assist($server->uuid, $binding->serverName, true, $reason ?: $binding->reason));

        return ToolResult::ok([
            'server' => $binding->serverName,
            'access' => 'read-write',
            'tools' => $binding->tools(),
            'note' => 'You may now edit files, change startup variables, change the Docker image and restart this server. '
                . 'Read a file before writing it, change the least you can, and say what you changed. '
                . 'The panel tools you no longer have were for reading records you have already read.',
        ]);
    }

    /*
    |--------------------------------------------------------------------------
    | Batching
    |--------------------------------------------------------------------------
    |
    | One approval over many calls. The problem it solves is not only that
    | twenty product creations meant twenty cards — it is that nobody reads card
    | fifteen, and the card is the only thing standing between the model and the
    | panel. Reviewing less was never an option; reviewing the whole set at once,
    | before any of it runs, is.
    |
    | It also happens to be the only way the work fits at all. A suspension
    | carries `step` through `toState()`, so twenty sequential writes exhaust
    | `max_steps` long before they are done, and the one strategy that would fit
    | — twenty calls in a single response — is exactly what an approval destroys,
    | since the loop returns on the first suspension and `closeUnresolvedCalls()`
    | answers every sibling with `not_executed`.
    */

    /**
     * Expand a batch into something that can be approved whole, or refuse it.
     *
     * Everything is settled here, before `suspend()` is reached: every child is
     * resolved, checked against what this step actually offered, and validated
     * against its own schema. A batch that fails any of that is refused as a
     * single retryable error and no card is drawn at all.
     *
     * That all-or-nothing rule is the whole point. A card promising twenty
     * products that fails on the seventh is worse than twenty cards, because by
     * then the user has already spent the attention the card exists to collect —
     * and has been told something happened that did not. So a card exists only
     * for a batch that will run as shown, and a half-valid batch goes back to the
     * model to be rewritten.
     *
     * @param ToolDefinition[] $offered the tools on offer this step, so a name that
     *                                  resolves in the registry but was filtered out
     *                                  for this user cannot reach the card by being
     *                                  nested inside a batch
     *
     * @return ToolResult|array{0: array, 1: string} the refusal, or the normalised
     *                                               arguments and the tier the set runs at
     */
    protected function planBatch(array $arguments, array $offered): ToolResult|array
    {
        $calls = SharedTools::normaliseCalls($arguments['calls'] ?? []);
        $max = $this->maxBatchCalls();

        if (count($calls) < SharedTools::MIN_BATCH_CALLS) {
            return ToolResult::error('invalid_arguments', sprintf(
                'A batch needs at least %d calls. For a single change, call the tool directly.',
                SharedTools::MIN_BATCH_CALLS
            ), retryable: true);
        }

        if (count($calls) > $max) {
            return ToolResult::error('batch_too_large', sprintf(
                'A batch holds at most %d calls and you asked for %d. Send the first %d now and the rest '
                    . 'in a second batch afterwards.',
                $max,
                count($calls),
                $max
            ), retryable: true);
        }

        $available = [];
        foreach ($offered as $definition) {
            $available[$definition->name] = true;
        }

        $wrapper = $this->registry->find(SharedTools::BATCH);
        $risk = $wrapper === null
            ? ToolDefinition::RISK_SAFE
            : $this->riskGate->resolve($wrapper, $arguments);
        $planned = [];

        foreach ($calls as $index => $child) {
            $position = $index + 1;
            $definition = $child['tool'] === '' ? null : $this->registry->find($child['tool']);

            if ($definition === null || !isset($available[$child['tool']])) {
                return ToolResult::error('unknown_tool', sprintf(
                    'Call %d names "%s", which is not a tool you have here. A batch may only hold tools '
                        . 'from your own list.',
                    $position,
                    $child['tool'] !== '' ? $child['tool'] : '(nothing)'
                ), retryable: true);
            }

            // Host-handled tools suspend, bind, or widen a grant — none of which
            // survives being nested. `ask_user` cannot ask from inside a batch
            // that is itself waiting to be approved, and the assist tools would
            // let one click both open a session on a customer's server and change
            // things on it, where those changes were written before the model had
            // seen anything on that server. The discovery tools are excluded for a
            // duller reason: a batch is fixed when the card is drawn, so loading a
            // tool inside one could not affect any of its siblings anyway.
            if ($definition->hostHandled) {
                return ToolResult::error('not_batchable', sprintf(
                    'Call %d (%s) cannot go in a batch — it needs the user before it can do anything. '
                        . 'Take it out and call it on its own.',
                    $position,
                    $definition->name
                ), retryable: true);
            }

            // A file write needs a server-attested diff for every individual
            // target. Generic batches have no per-child attestation phase, so
            // accepting one here would reduce an exact diff to model-supplied
            // JSON in the batch card.
            if ($definition->name === 'files_write') {
                return ToolResult::error('not_batchable', sprintf(
                    'Call %d (files_write) cannot go in a batch. Request each file write separately so its exact live diff can be reviewed.',
                    $position
                ), retryable: true);
            }

            $validation = $this->registry->validate($definition, $child['arguments']);

            if (!$validation['valid']) {
                return ToolResult::error('invalid_arguments', sprintf(
                    'Call %d (%s) is not valid: %s Fix it and send the whole batch again.',
                    $position,
                    $definition->name,
                    implode(' ', $validation['errors'])
                ), retryable: true);
            }

            $childRisk = $this->riskGate->resolve($definition, $validation['value']);

            if ($childRisk === ToolDefinition::RISK_DESTRUCTIVE && !$this->allowDestructiveBatches()) {
                return ToolResult::error('not_batchable', sprintf(
                    'Call %d (%s) destroys data, and this panel does not allow that inside a batch. '
                        . 'Take it out and ask for it on its own, where it gets its own confirmation.',
                    $position,
                    $definition->name
                ), retryable: true);
            }

            $risk = $this->riskGate->max($risk, $childRisk);
            $planned[] = ['tool' => $definition->name, 'arguments' => $validation['value']];
        }

        return [
            [
                'summary' => trim((string) ($arguments['summary'] ?? '')),
                'calls' => $planned,
                'on_error' => ($arguments['on_error'] ?? null) === 'continue' ? 'continue' : 'stop',
            ],
            $risk,
        ];
    }

    /**
     * Run a batch the user has approved.
     *
     * Two passes. The first re-asks every question that could have changed while
     * the card sat on screen — the tool still exists, the user may still run it,
     * and its tier has not been raised above what was approved — and refuses the
     * whole batch if any of them has. Answering these per call as it went would
     * mean a batch that half-ran because an operator hardened a tool at the wrong
     * moment, which is the one outcome worse than not running.
     *
     * The second pass dispatches, emitting each call's own `tool_call` and
     * `tool_result` under an id derived from the batch's. The transcript then
     * reads as the individual calls it actually made, which is both what the
     * existing tool rows already render and what an audit of this should show —
     * `runTool()` writes one `AiToolCall` per child for the same reason.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function runBatch(
        AgentContext $context,
        ToolCallData $call,
        array $arguments,
        string $approvedRisk,
        callable $emit,
    ): ToolResult {
        $calls = SharedTools::normaliseCalls($arguments['calls'] ?? []);
        $stopOnError = ($arguments['on_error'] ?? null) !== 'continue';

        if ($calls === []) {
            return ToolResult::error('invalid_arguments', 'That batch had nothing in it.');
        }

        $wrapper = $this->registry->find($call->name);
        $wrapperRisk = $wrapper === null
            ? ToolDefinition::RISK_DESTRUCTIVE
            : $this->riskGate->resolve($wrapper, $arguments);
        if ($this->riskGate->max($approvedRisk, $wrapperRisk) !== $approvedRisk) {
            return ToolResult::error(
                'risk_changed',
                sprintf('The batch wrapper now requires "%s" approval, so none of this batch was run. Ask for it again.', $wrapperRisk)
            );
        }

        if (count($calls) < SharedTools::MIN_BATCH_CALLS || count($calls) > $this->maxBatchCalls()) {
            return ToolResult::error(
                'batch_policy_changed',
                sprintf('The live batch limit is %d calls, so none of this batch was run. Ask for it again.', $this->maxBatchCalls())
            );
        }

        /** @var array<int, array{0: ToolDefinition, 1: string}> $resolved */
        $resolved = [];

        foreach ($calls as $index => $child) {
            $position = $index + 1;
            $definition = $child['tool'] === '' ? null : $this->registry->find($child['tool']);

            if ($definition === null || $definition->hostHandled) {
                return ToolResult::error('unavailable', sprintf(
                    'Call %d (%s) is no longer available, so none of this batch was run.',
                    $position,
                    $child['tool'] !== '' ? $child['tool'] : '(nothing)'
                ));
            }

            if (!$this->usable($context, $definition)) {
                return ToolResult::error('forbidden', sprintf(
                    'You no longer have permission to run call %d (%s), so none of this batch was run. '
                        . 'Say which permission is missing and stop.',
                    $position,
                    $definition->name
                ));
            }

            $validation = $this->registry->validate($definition, $child['arguments']);
            if (!$validation['valid']) {
                return ToolResult::error('invalid_arguments', sprintf(
                    'Call %d (%s) no longer passes the live tool contract, so none of this batch was run.',
                    $position,
                    $definition->name,
                ));
            }

            $childRisk = $this->riskForContext($context, $definition, $validation['value']);

            if ($childRisk === ToolDefinition::RISK_DESTRUCTIVE && !$this->allowDestructiveBatches()) {
                return ToolResult::error('batch_policy_changed', sprintf(
                    'Call %d (%s) is destructive and destructive batches are now disabled, so none was run.',
                    $position,
                    $definition->name,
                ));
            }

            // Approval is a ceiling, not a token. An operator who hardened a tool
            // while the card was open must not be bypassed by a click that
            // predates the change.
            if ($this->riskGate->max($approvedRisk, $childRisk) !== $approvedRisk) {
                return ToolResult::error('risk_changed', sprintf(
                    'Call %d (%s) now counts as a "%s" action, which is more than this batch was approved '
                        . 'for, so none of it was run. Ask for it again.',
                    $position,
                    $definition->name,
                    $childRisk
                ));
            }

            $resolved[$index] = [$definition, $childRisk];
        }

        $deadline = $this->beginDeadline($context);

        $report = [];
        $succeeded = 0;
        $failed = 0;
        $halted = null;

        foreach ($calls as $index => $child) {
            [$definition, $childRisk] = $resolved[$index];

            // A stop is observed between children, like every other boundary.
            // The batch is explicitly partial by design, so this needs no new
            // outcome: the children that ran are reported as having run, and
            // the rest say why they did not.
            if ($halted === null && $this->stopRequested($context)) {
                $halted = 'cancelled';
            }

            if ($halted === null && $this->now() >= $deadline) {
                $halted = 'out_of_time';
            }

            if ($halted !== null) {
                $report[] = ['tool' => $definition->name, 'not_run' => $halted];

                continue;
            }

            $childCall = $this->batchChildCall(
                $context,
                $call,
                $index,
                $definition->name,
                $child['arguments'],
            );

            $emit(AgentEvent::toolCall(
                $childCall->id,
                $definition->name,
                $child['arguments'],
                $childRisk,
                $childCall->batchParentId,
                $childCall->batchIndex,
            ));

            $startedAt = microtime(true);
            $result = $this->runTool($context, $childCall, $definition, $child['arguments'], $childRisk);

            $this->emitRedactions($context, $emit);

            $emit(AgentEvent::toolResult(
                $childCall->id,
                $definition->name,
                $result->ok,
                $result->summary(),
                $result->ok ? $result->data : null,
                (int) round((microtime(true) - $startedAt) * 1000),
                $result->outcome,
                $childCall->batchParentId,
                $childCall->batchIndex,
            ));

            if ($result->ok) {
                ++$succeeded;
                $report[] = ['tool' => $definition->name, 'ok' => true, 'summary' => $result->summary()];

                continue;
            }

            ++$failed;
            $report[] = ['tool' => $definition->name, 'ok' => false, 'error' => $result->summary()];

            if ($stopOnError) {
                $halted = 'earlier_failure';
            }
        }

        return ToolResult::batch(array_filter([
            'batch' => true,
            'succeeded' => $succeeded,
            'failed' => $failed,
            'not_run' => count($calls) - $succeeded - $failed,
            'calls' => $report,
            // Summaries rather than the records themselves: twenty shaped results
            // would cost more context than the rest of the turn put together, and
            // reading back what was created is one cheap call when it is needed.
            'note' => $succeeded > 0
                ? 'Only summaries are returned. If you need what was created, read it back with a list tool.'
                : null,
        ], fn ($v) => $v !== null));
    }

    /**
     * Give a batch child its own deterministic identity and retain its lineage.
     *
     * The old `parent.0` convention collided with a valid provider id of the
     * same value. This turn-bound digest remains stable for idempotent retries
     * without occupying the provider-controlled namespace.
     */
    protected function batchChildCall(
        AgentContext $context,
        ToolCallData $parent,
        int $index,
        string $tool,
        array $arguments,
    ): ToolCallData {
        return new ToolCallData(
            ToolCallData::derivedBatchId(
                substr(hash('sha256', implode("\0", [
                    $context->turnId,
                    (string) $context->step,
                    $parent->id,
                ])), 0, 32),
                $index,
            ),
            $tool,
            $arguments,
            $parent->id,
            $index,
        );
    }

    /**
     * Whether a tool may still be run in this turn.
     *
     * Asked again at the point of running rather than trusted from the moment it
     * was offered, because an approval can sit on screen for minutes and an
     * operator may have changed something in between.
     *
     * A server-scoped tool reached through an assist session is judged against
     * the *binding* rather than the acting user's own access to that server —
     * which they do not have, and which is the entire point of the binding. The
     * capability behind the binding has already been re-checked by the time a
     * turn resumes.
     */
    public function usable(AgentContext $context, ToolDefinition $definition): bool
    {
        if ($this->registry->isDisabled($definition->name)) {
            return false;
        }

        if (
            $context->assist !== null
            && $context->server === null
            && $definition->scope === ToolDefinition::SCOPE_SERVER
        ) {
            return $context->targetServer() !== null
                && $this->registry->assistPermits(
                    $definition,
                    $context->assist->tools(),
                    $context->assist->abilities
                );
        }

        return $this->registry->canUse($context->user, $context->server, $definition);
    }

    /**
     * Execute an approved or automatic call and record it for audit.
     */
    public function runTool(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        array $arguments,
        string $risk,
        ?AiToolCall $record = null,
    ): ToolResult {
        // A server-scoped tool records the server it actually touched, which
        // during an assist session is the customer's rather than none at all —
        // the audit trail is the whole justification for the feature.
        $target = $context->targetServer();
        $subject = $definition->scope === ToolDefinition::SCOPE_SERVER ? $target : $context->server;

        $attributes = [
            'turn_id' => $context->turnId,
            'conversation_id' => $context->conversationId,
            'user_id' => $context->user->id,
            'server_uuid' => $subject?->uuid,
            'scope' => $context->scope(),
            'tool_call_id' => $call->id,
            'batch_parent_tool_call_id' => $call->batchParentId,
            'batch_index' => $call->batchIndex,
            'tool_name' => $definition->name,
            'risk' => $risk,
            'step' => $context->step,
            'arguments' => $arguments,
            'status' => AiToolCall::STATUS_RUNNING,
        ];

        if ($record === null) {
            $record = AiToolCall::create($attributes);
        } else {
            $record->update([
                'risk' => $risk,
                'arguments' => $arguments,
                'status' => AiToolCall::STATUS_RUNNING,
                'resolved_at' => null,
            ]);
        }

        if (!$this->hasTime($context)) {
            $result = ToolResult::error('time_limit', 'The turn deadline was reached before this tool could start.');
            $record->update([
                'status' => AiToolCall::STATUS_FAILED,
                'result_summary' => $result->summary(),
                'duration_ms' => 0,
                'resolved_at' => now(),
            ]);

            return $result;
        }

        $startedAt = $this->now();

        $invocation = $definition->invoke(
            $arguments,
            $this->registry->contextForTool($definition, $target, $arguments)
        )->withIdempotencyKey($context->idempotencyKeyFor($call->id));

        try {
            $result = $definition->shape($this->dispatch($context, $definition, $invocation));
            $result = $this->redact($context, $result)->capped($this->toolResultBytes());
        } catch (\Throwable $e) {
            // The executor renders almost everything into a failed result, so
            // reaching here means the failure was ours — a shaper, the redactor,
            // the assist window. The row was set running a few lines above and
            // would otherwise stay that way for good, which is the one thing an
            // audit trail must not do. Terminal here, then rethrown: the stream
            // owner decides what the turn does about it.
            $record->update([
                'status' => AiToolCall::STATUS_FAILED,
                'result_summary' => 'The call did not complete.',
                'duration_ms' => (int) round(($this->now() - $startedAt) * 1000),
                'resolved_at' => now(),
            ]);

            throw $e;
        }

        $record->update([
            'status' => $result->ok ? AiToolCall::STATUS_SUCCEEDED : AiToolCall::STATUS_FAILED,
            'http_status' => $result->status,
            'result_summary' => $result->summary(),
            'duration_ms' => (int) round(($this->now() - $startedAt) * 1000),
            'resolved_at' => now(),
        ]);

        return $result;
    }

    /**
     * Bind automatic admin companion reads to the subject whose assist card was
     * approved. Customer-controlled ticket, file, and console text is model
     * input, so an identifier copied from it must not become authority to read
     * another customer's panel record.
     */
    protected function assistSubjectAllows(
        AgentContext $context,
        ToolDefinition $definition,
        array $arguments,
    ): bool {
        if ($context->assist === null || $context->server !== null) {
            return true;
        }

        $server = $context->targetServer();
        if ($server === null) {
            return false;
        }

        $expected = match ($definition->name) {
            'admin_server_view' => ['server', $server->getKey()],
            'admin_user_view' => ['user', $server->owner_id],
            'admin_ticket_view', 'admin_ticket_messages' => ['ticket', $context->assist->ticketId],
            default => null,
        };

        if ($expected === null) {
            return true;
        }

        [$field, $subjectId] = $expected;

        return $subjectId !== null
            && array_key_exists($field, $arguments)
            && hash_equals((string) $subjectId, (string) $arguments[$field]);
    }

    /**
     * Cross-subject reads remain possible for an administrator, but never as
     * an invisible side effect of untrusted content. Raising them to WRITE
     * makes the target arguments visible on a dedicated approval card.
     */
    protected function riskForContext(
        AgentContext $context,
        ToolDefinition $definition,
        array $arguments,
    ): string {
        $risk = $this->riskGate->resolve($definition, $arguments);

        return $this->assistSubjectAllows($context, $definition, $arguments)
            ? $risk
            : $this->riskGate->max($risk, ToolDefinition::RISK_WRITE);
    }

    /**
     * Send the sub-request, opening the assist window around it if this call
     * needs one.
     *
     * The window is this narrow on purpose. `AuthenticateServerAccess` and
     * `ServerPolicy` both consult the session, and a session left open for the
     * turn would mean any later dispatch in the same PHP request inherited an
     * administrator's access to a customer's server. Opened here, it covers one
     * call and closes in a `finally` whatever that call does.
     */
    protected function dispatch(AgentContext $context, ToolDefinition $definition, ToolInvocation $invocation): ToolResult
    {
        $run = fn () => $this->executor->execute(
            $invocation,
            $this->remainingSeconds($context),
        );

        $needsSession = $context->assist !== null
            && $context->server === null
            && $definition->scope === ToolDefinition::SCOPE_SERVER;

        return $needsSession
            ? $this->assist->during($context->user, $context->assist, $run)
            : $run();
    }

    /**
     * Take personal data out of a tool result before the model sees it.
     *
     * Applied here, on the shaped payload, rather than at the provider boundary:
     * this is the last point at which the data is still structured, and field
     * names are most of what makes redaction accurate. By the time a result has
     * been encoded into a message it is prose, and only the patterns are left.
     */
    protected function redact(AgentContext $context, ToolResult $result): ToolResult
    {
        if (!$result->ok && !$result->isBatch()) {
            return $result;
        }

        $redacted = $this->redactor->redact($result->data, $context->redactions);

        return $redacted === $result->data
            ? $result
            : $result->replaceData($redacted);
    }

    /**
     * Persist the turn and stop, so a human can decide.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function suspend(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        array $arguments,
        string $risk,
        callable $emit,
    ): void {
        $arguments = $this->attestApprovalArguments($context, $definition, $arguments);

        $this->persistPending($context, $call, $definition->name, $arguments, $risk);

        AiToolCall::create([
            'turn_id' => $context->turnId,
            'conversation_id' => $context->conversationId,
            'user_id' => $context->user->id,
            // Attribute assisted writes to the customer's server, not to the
            // admin surface whose own server binding is null.
            'server_uuid' => $context->targetServer()?->uuid,
            'scope' => $context->scope(),
            'tool_call_id' => $call->id,
            'batch_parent_tool_call_id' => $call->batchParentId,
            'batch_index' => $call->batchIndex,
            'tool_name' => $definition->name,
            'risk' => $risk,
            'step' => $context->step,
            'arguments' => $arguments,
            'status' => AiToolCall::STATUS_PENDING_APPROVAL,
        ]);

        $emit(AgentEvent::approvalRequired(
            $context->turnId,
            $definition->name,
            $arguments,
            $risk,
            ApprovalPreview::for($definition->name, $arguments, $context->targetServer()),
        ));
    }

    /** Replace security-sensitive preview inputs with live server evidence. */
    protected function attestApprovalArguments(
        AgentContext $context,
        ToolDefinition $definition,
        array $arguments,
    ): array {
        if ($definition->name === AdminTools::ASSIST_SERVER) {
            $server = $this->assist->resolveServer((string) ($arguments['server'] ?? ''));
            if ($server === null) {
                throw new \RuntimeException('An assist session cannot be approved without a live target server.');
            }

            // The card and authenticated grant name one immutable target. A
            // numeric or short reference is useful model input, but is not a
            // durable authorization identity.
            $arguments['server'] = $server->uuid;
        } elseif ($definition->name === 'files_write') {
            $target = $context->targetServer();
            $file = (string) ($arguments['file'] ?? '');

            if ($target === null || $file === '') {
                throw new \RuntimeException('A file write cannot be attested without its target server and path.');
            }

            // The model's original_content is never evidence. Replace it with
            // content read directly from Wings before persisting or rendering
            // the approval, bounded to the endpoint's accepted file size.
            $arguments['original_content'] = $this->files
                ->setServer($target)
                ->getContent($file, \Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest::MAX_CONTENT_BYTES);
        }

        return $arguments;
    }

    /**
     * Persist the turn and stop, so the user can answer a question.
     *
     * No AiToolCall row: nothing was executed and nothing is waiting to be, so
     * an audit entry would only add noise to a trail whose whole purpose is
     * recording what the model did to the panel.
     *
     * @param array<int, array{label: string, description?: string}> $options
     * @param callable(AgentEvent): void $emit
     */
    protected function suspendForQuestion(
        AgentContext $context,
        ToolCallData $call,
        string $question,
        array $options,
        bool $allowOther,
        callable $emit,
    ): void {
        $arguments = [
            'question' => $question,
            'options' => $options,
            'allow_other' => $allowOther,
        ];

        $this->persistPending($context, $call, SharedTools::ASK_USER, $arguments, ToolDefinition::RISK_SAFE);

        $emit(AgentEvent::questionRequired($context->turnId, $question, $options, $allowOther));
    }

    /**
     * Write the suspended turn.
     *
     * Shared by both kinds of pause: the state that has to survive is the same,
     * and a second copy of it is a second place for a resume bug to hide.
     */
    protected function persistPending(
        AgentContext $context,
        ToolCallData $call,
        string $toolName,
        array $arguments,
        string $risk,
    ): void {
        $context->suspended = true;
        $sealed = $this->sealPendingAssistGrant($context, $toolName, $arguments);

        AiPendingAction::updateOrCreate(
            ['turn_id' => $context->turnId],
            [
                'conversation_id' => $context->conversationId,
                'user_id' => $context->user->id,
                // See `suspend()`: the server the pending call is against, not
                // the surface's own binding.
                'server_uuid' => $sealed['binding']?->serverUuid ?? $context->targetServer()?->uuid,
                'scope' => $context->scope(),
                'tool_name' => $toolName,
                // The model's own id for this call. Resuming has to answer with
                // the same one — a fabricated id is rejected by every provider.
                'tool_call_id' => $call->id,
                'risk' => $risk,
                'arguments' => $arguments,
                'state' => $context->toState(),
                'assist_grant' => $sealed['grant'],
                'assist_grant_mac' => $sealed['mac'],
                'step' => $context->step,
                'status' => AiPendingAction::STATUS_PENDING,
                'expires_at' => now()->addMinutes(AiPendingAction::EXPIRY_MINUTES),
            ]
        );
    }

    /**
     * Authenticate the exact assist authority a suspended action starts with
     * and, for an open/escalate card, the authority it is allowed to create.
     *
     * @return array{grant: ?array, mac: ?string, binding: ?AssistBinding}
     */
    protected function sealPendingAssistGrant(AgentContext $context, string $toolName, array $arguments): array
    {
        if ($context->scope() !== ToolDefinition::SCOPE_ADMIN) {
            return ['grant' => null, 'mac' => null, 'binding' => null];
        }

        $phase = AssistGrant::PHASE_NONE;
        $before = $context->assist;
        $after = $before;

        if ($toolName === AdminTools::ASSIST_SERVER) {
            $server = $this->assist->resolveServer((string) ($arguments['server'] ?? ''));
            if ($server === null) {
                throw new \RuntimeException('The approved assist target no longer exists.');
            }

            $phase = AssistGrant::PHASE_OPEN;
            $before = null;
            $after = new AssistBinding(
                serverUuid: $server->uuid,
                serverName: (string) $server->name,
                reason: trim((string) ($arguments['reason'] ?? '')),
                ticketId: isset($arguments['ticket']) && is_numeric($arguments['ticket'])
                    ? (int) $arguments['ticket']
                    : null,
            );
        } elseif ($toolName === AdminTools::ASSIST_ALLOW_WRITES) {
            if ($before === null || $before->writable) {
                throw new \RuntimeException('A read-only assist binding is required before approving escalation.');
            }

            $phase = AssistGrant::PHASE_ESCALATE;
            $after = $before->escalated();
        } elseif ($before !== null) {
            $phase = AssistGrant::PHASE_ACTIVE;
        }

        $sealed = AssistGrant::seal(
            $phase,
            $before,
            $after,
            $context->turnId,
            (int) $context->user->id,
            $toolName,
            $arguments,
        );

        return ['grant' => $sealed['grant'], 'mac' => $sealed['mac'], 'binding' => $after];
    }

    protected function pushToolResult(AgentContext $context, ToolCallData $call, ToolResult $result): void
    {
        $context->push(
            AiMessage::tool(
                $call->id,
                $call->name,
                $result->toModelPayload(),
                !$result->ok,
            ),
            TurnRecorder::toolDisplay(
                $result->ok,
                $result->summary(),
                $result->outcome,
                $result->isBatch() ? $result->data : null,
                $call->batchParentId,
                $call->batchIndex,
            ),
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Limits
    |--------------------------------------------------------------------------
    */

    /**
     * The bounds a turn's wall clock is settable between.
     *
     * Public because they are the single definition three other places have to
     * agree with: `UpdateIntelligenceSettingsRequest` validates against them,
     * the admin form's number input uses the same pair, and the client's idle
     * watchdog is derived from whatever this returns. When validation accepted
     * 15 and this floored at 30, an operator could save a value the panel
     * displayed back to them and the agent never used.
     */
    public const MIN_WALL_SECONDS = 30;
    public const MAX_WALL_SECONDS = 900;

    /** How often a durable turn re-derives that it is still authorized. */
    public const AUTHORITY_RECHECK_SECONDS = 5.0;

    public function maxSteps(): int
    {
        return max(1, (int) $this->setting('agent:max_steps', config('modules.ai.agent.max_steps', 12)));
    }

    public function maxWallSeconds(): int
    {
        return min(self::MAX_WALL_SECONDS, max(
            self::MIN_WALL_SECONDS,
            (int) $this->setting('agent:max_wall_seconds', config('modules.ai.agent.max_wall_seconds', 180)),
        ));
    }

    /** Longest healthy SSE silence, including a small transport margin. */
    public function streamIdleSeconds(): int
    {
        return $this->maxWallSeconds() + 30;
    }

    protected function maxRepairs(): int
    {
        return max(0, (int) $this->setting('agent:max_repairs', config('modules.ai.agent.max_repairs', 2)));
    }

    /**
     * How many calls one batch may carry.
     *
     * Floored at the minimum a batch is allowed to be rather than at 1: an
     * operator who sets this to zero means "no batching", and the honest way to
     * say that is to disable the tool in the catalogue, not to leave a tool
     * offered that refuses every call it is given.
     */
    protected function maxBatchCalls(): int
    {
        return max(
            SharedTools::MIN_BATCH_CALLS,
            (int) $this->setting('agent:max_batch_calls', config('modules.ai.agent.max_batch_calls', 25))
        );
    }

    protected function allowDestructiveBatches(): bool
    {
        return (bool) $this->setting(
            'agent:allow_destructive_batches',
            config('modules.ai.agent.allow_destructive_batches', false)
        );
    }

    /**
     * Sibling calls consume one model step, so bound their fan-out separately.
     */
    protected function maxCallsPerResponse(): int
    {
        return max(1, min(8, $this->maxBatchCalls()));
    }

    protected function hasTime(AgentContext $context): bool
    {
        return $this->now() < $this->beginDeadline($context);
    }

    protected function remainingSeconds(AgentContext $context): int
    {
        return max(1, (int) ceil($this->beginDeadline($context) - $this->now()));
    }

    /**
     * Isolated for deterministic deadline tests.
     */
    protected function now(): float
    {
        return microtime(true);
    }

    /**
     * How many complete tool schemas the model may be offered in one step.
     *
     * Delegated to `ToolBudget`, which reads `agent:max_tools` when an operator
     * has set one and otherwise works it out from the model. The setting used to
     * default to 32 for everybody, which was a guess made once on behalf of every
     * deployment — and a bad one for the small local models the panel is most
     * often run against.
     */
    protected function maxTools(): int
    {
        return $this->budget->schemas();
    }

    /**
     * Whether to ask the model to think before it acts.
     *
     * On by default: choosing between fifteen tools is exactly the work
     * reasoning helps with, and the visible thinking is most of what makes a
     * long turn legible. An operator paying per token can turn it off, and a
     * model that cannot reason ignores the request either way.
     */
    protected function reasoningEnabled(): bool
    {
        return (bool) $this->setting('agent:reasoning', config('modules.ai.agent.reasoning', true));
    }

    protected function toolResultBytes(): int
    {
        return max(1024, (int) $this->setting('agent:tool_result_bytes', config('modules.ai.agent.tool_result_bytes', 12288)));
    }

    protected function setting(string $key, mixed $default = null): mixed
    {
        return Setting::get('settings::modules:ai:' . $key, $default);
    }
}
