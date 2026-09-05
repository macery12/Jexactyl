<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Setting;
use Everest\Facades\LogBatch;
use Everest\Models\AiToolCall;
use Everest\Models\AiPendingAction;
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
use Everest\Services\Files\FileDiffService;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\ToolInvocation;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\ToolCallSalvager;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;

/**
 * Drives one agent turn: model call, tool calls, repeat.
 *
 * Bounded by steps, wall clock, the inference lease and repetition. Ends when
 * the model stops requesting tools, a bound is hit, or a human decision is
 * needed — which suspends rather than blocks. Each step offers a working set
 * from `WorkingSetPlanner`, not the whole catalogue; only offered tools can run.
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
        private FileDiffService $fileDiffs,
        private TurnCancellations $cancellations,
        private WorkingSetPlanner $planner,
        private ToolDiscoveryService $discovery,
        private PrerequisiteResolver $prerequisites,
        private ProgressGuard $progress,
        private IdentifierEvidenceGuard $identifierEvidence,
        private ToolBudget $budget,
        private TurnExecutionPolicy $executionPolicy,
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
     * Run a turn, emitting events as it goes. Does not acquire the inference
     * slot — admission is the caller's job, so the slot is already held by
     * the time this runs (otherwise a queue ticket is issued instead).
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
            // registered name or one of its precise intent phrases has already
            // done the retrieval; making the model spend a step rediscovering it
            // is the most annoying failure this mechanism can produce.
            $message = $this->lastUserMessage($context);
            $this->executionPolicy->apply($context, $message);
            $this->discovery->pinUserIntentTools($context, $message);

            $this->loop($context, $emit, $startedAt);
        } catch (\Throwable $e) {
            Log::error('AI agent turn failed.', [
                'turn' => $context->turnId,
                'exception' => $e::class,
            ]);

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
        $conclusionPassUsed = false;

        while ($context->step < $maxSteps || ($context->conclusionRequired && !$conclusionPassUsed)) {
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

            $concluding = $context->conclusionRequired;
            $conclusionPassUsed = $conclusionPassUsed || $concluding;
            $definitions = $concluding ? [] : $this->offerings($context)->definitions;
            $tools = $this->registry->toAiTools($definitions);

            if (!$this->hasTime($context)) {
                $emit(AgentEvent::done('time_limit'));

                return;
            }

            $response = $this->callModel($context, $tools, $emit);

            $calls = $response['calls'];
            $text = $response['text'];
            $reasoning = $response['reasoning'];

            // Some local reasoning templates emit a complete thought, stop,
            // and never transition to either `content` or `tool_calls`. From
            // the user's perspective the assistant simply disappears. Never
            // expose the thought as the answer; retry the exact step once with
            // reasoning disabled so the model has to use a public channel.
            if ($calls === [] && trim($text) === '' && $response['reasoning_observed']) {
                Log::notice('AI agent is retrying a reasoning-only empty response without reasoning.', [
                    'turn' => $context->turnId,
                    'step' => $context->step,
                ]);

                if (!$this->hasTime($context)) {
                    $emit(AgentEvent::done('time_limit'));

                    return;
                }

                $response = $this->callModel($context, $tools, $emit, false);
                $calls = $response['calls'];
                $text = $response['text'];
                $reasoning = $response['reasoning'];

                if (!$concluding && $calls === [] && trim($text) === '') {
                    throw new AIServiceException('The model stopped without providing an answer or a tool call. Please try again.');
                }
            }

            // This pass is deliberately tool-free. Even if a weak provider
            // hallucinates another structured call, the host does not execute
            // it; a blank response falls back to the boundary established by
            // the panel rather than restarting the loop.
            if ($concluding) {
                $final = trim($text);
                if ($final === '') {
                    $final = $context->conclusionFallback
                        ?? 'The requested action is not available in this session, so no change was made.';
                    $emit(AgentEvent::text($final));
                }

                $context->push(AiMessage::assistant($final));
                $emit(AgentEvent::done('capability_boundary'));

                return;
            }

            // An empty stop without a reasoning event is just as invalid, but
            // there is no alternate channel to recover. Surface a truthful
            // error instead of persisting a blank assistant message and marking
            // the turn complete.
            if ($calls === [] && trim($text) === '') {
                throw new AIServiceException('The model stopped without providing an answer or a tool call. Please try again.');
            }

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
            $repairKind = null;

            if ($calls === [] && $this->shouldRepair($context, $text)) {
                ++$context->repairs;
                $repairKind = 'malformed_tool_call';
                $calls = $this->repair($context, $tools, $text);
            }

            // A small model sometimes narrates the next operation as if saying
            // it were the operation: "Next, I will inspect startup" with no
            // call. That is neither a final answer nor malformed JSON, so the
            // ordinary salvager cannot see it. Recover one call under the same
            // schema, repair-count and deadline bounds rather than recording the
            // promise as a successful terminal turn.
            $unfinishedIntention = $calls === []
                && $tools !== []
                && $this->salvager->looksLikeUnfinishedIntent($text);

            if ($unfinishedIntention && $context->repairs < $this->maxRepairs()) {
                ++$context->repairs;
                $repairKind = 'unfinished_intention';
                $calls = $this->repair(
                    $context,
                    $tools,
                    $text,
                    'You announced a next action but did not call a tool. Reply with only the JSON object for the one offered tool that performs that announced action now.',
                );
            }

            if ($calls === []) {
                // A repair that produced nothing means `$text` is the malformed
                // call that triggered it — `looksLikeAttempt()` said so. Pushing
                // it as the answer would put a wall of half-written JSON on the
                // user's screen labelled as a completed turn, which is exactly
                // the failure mode of the small local models the salvager exists
                // for. Better to say what happened.
                if ($repairKind !== null || $unfinishedIntention) {
                    Log::warning('AI agent turn abandoned: promised action could not be recovered', [
                        'turn' => $context->turnId,
                        'step' => $context->step,
                        'kind' => $repairKind ?? 'repair_limit',
                    ]);

                    throw new AIServiceException($unfinishedIntention ? 'The model announced another action but did not issue its tool call. The panel refused to mark that promise as complete. Please try again.' : 'The model tried to use a tool but could not write the request correctly. This usually means the model is too small for the number of tools it was offered — try again, or ask an administrator to lower the tool limit.');
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

                if ($outcome === 'concluding') {
                    $this->answerUnrunCalls($context);
                    break;
                }
            }
        }

        $emit(AgentEvent::done('step_limit'));
    }

    /**
     * Whether this turn should stop at the boundary it has just reached: the
     * user asked, or its authority lapsed (a durable turn outlives its request,
     * so "still signed in" is no longer answered on the way in). Either way the
     * caller answers the calls the stop left unrun, keeping the transcript one a
     * provider accepts.
     *
     * Latched on first truth, so later checkpoints agree without re-asking and
     * the stream owner can tell a stopped turn from a completed one.
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
     * Rate limited rather than checked at every boundary — `stopRequested()`
     * runs between steps, before each call in a multi-call response, and
     * between batch children, so an unthrottled check would run two indexed
     * queries per child of a twenty-call batch to answer something that only
     * changes at human speed. A revocation lands within the interval; nothing
     * escalates faster than that.
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
     * Surface-specific reasoning — which groups are active, how an assist
     * session narrows the admin catalogue, what fits — now lives in
     * `WorkingSetPlanner`. What's left here is what the runner owns: ask for
     * a set and pass it to the model.
     */
    protected function offerings(AgentContext $context): WorkingSet
    {
        // Recomputed rather than trusted. An assist session can be dropped
        // between steps by `AssistAuthorizer::reauthorize()`, and a phase that
        // outlived its binding would keep offering a customer's server tools.
        $context->phase = $context->resolvePhase();

        return $this->planner->plan($context, $this->maxTools());
    }

    /**
     * One model call. Text and reasoning stream straight through; tool calls
     * are collected.
     *
     * @param AiTool[] $tools
     * @param callable(AgentEvent): void $emit
     *
     * @return array{text: string, calls: ToolCallData[], reasoning: array<int, array>, reasoning_observed: bool}
     */
    protected function callModel(
        AgentContext $context,
        array $tools,
        callable $emit,
        ?bool $reasoning = null,
    ): array {
        $provider = $this->factory->make($this->remainingSeconds($context));

        $request = (new AiRequest(
            // Runtime facts and console text are tenant-controlled data. The
            // prompt builder attaches them to the latest user message instead of
            // granting them system-message authority.
            messages: $this->promptBuilder->contextualize($context),
            // The offered set is passed because two of the prompt's sections are
            // about tools that may not be on the table this step — the group
            // meta-tool and `ask_user`. Built without it they return null, which
            // silently drops the guidance on every step but a repair.
            systemPrompt: $this->promptBuilder->build($context, $tools),
            tools: $tools,
            // Tool selection benefits from determinism far more than prose
            // does; the configured temperature applies to the final answer.
            temperature: $tools !== [] ? 0.0 : null,
        ))->withReasoning($reasoning ?? $this->reasoningEnabled());

        // The prompt mints tokens of its own — a server whose name is an email
        // address, say — and they are minted before a single token of the answer
        // arrives. Draining here means the browser can already resolve them by
        // the time the model refers to one.
        $this->emitRedactions($context, $emit);

        $text = '';
        $calls = [];
        $reasoning = [];
        $reasoningObserved = false;

        foreach ($provider->stream($request) as $event) {
            switch ($event->type) {
                case AiStreamEvent::TYPE_TEXT:
                    $text .= (string) $event->text;
                    $emit(AgentEvent::text((string) $event->text));
                    break;

                case AiStreamEvent::TYPE_REASONING:
                    $reasoningObserved = $reasoningObserved || (string) $event->text !== '';
                    $emit(AgentEvent::reasoning((string) $event->text));
                    break;

                case AiStreamEvent::TYPE_REASONING_BLOCK:
                    $reasoningObserved = true;
                    $reasoning[] = $event->reasoningBlock;
                    break;

                    // Named but not yet fully written. Announced so the UI can say
                    // what is coming while the arguments are still arriving.
                case AiStreamEvent::TYPE_TOOL_CALL_START:
                    if ($tools !== [] && $event->toolCall !== null) {
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

        return [
            'text' => $text,
            'calls' => $calls,
            'reasoning' => $reasoning,
            'reasoning_observed' => $reasoningObserved,
        ];
    }

    /**
     * Ask again under a JSON-schema grammar, which on a local model makes
     * schema-valid output the only thing the sampler can emit.
     *
     * @param AiTool[] $tools
     *
     * @return ToolCallData[]
     */
    protected function repair(
        AgentContext $context,
        array $tools,
        string $text,
        string $instruction = 'That was not a valid tool call. Reply with only the JSON object for the tool you want to call.',
    ): array {
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

            $provider = $this->factory->make($this->remainingSeconds($context));

            $repairMessages = array_merge($context->messages, [
                AiMessage::assistant($text),
                AiMessage::user($instruction),
            ]);

            $request = (new AiRequest(
                messages: $this->promptBuilder->contextualize($context, $repairMessages),
                systemPrompt: $this->promptBuilder->build($context, $tools),
                tools: $tools,
                // This is not an ordinary agent step: the model has already
                // announced or malformed an action and is being asked to
                // recover that exact action. Leaving tool choice on `auto`
                // lets hosted models narrate the promise a second time.
                toolChoice: AiRequest::TOOL_CHOICE_REQUIRED,
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
            Log::warning('AI tool-call repair failed.', ['exception' => $e::class]);

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
            $result = $this->unofferedCall($context, $call, $definition);
            $this->pushToolResult($context, $call, $result);

            if ($this->requiresConclusion($result)) {
                $this->requireConclusion($context, $result);

                return 'concluding';
            }

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

        // A file read is redacted before it reaches the model. Restore only
        // exact handles minted in this conversation before those bytes become a
        // proposal, approval or audit record. Unknown lookalikes remain literal.
        $arguments = $this->restoreFileWriteArguments($context, $definition, $arguments);

        $isDiscovery = in_array($definition->name, [SharedTools::SEARCH_TOOLS, SharedTools::LOAD_TOOLS], true);
        if ($isDiscovery && $context->discoveryCallsInARow >= 2) {
            $result = ToolResult::error(
                'discovery_exhausted',
                'Two consecutive tool-discovery attempts have already run without an intervening action. '
                    . 'Do not search for more synonyms. Explain the capability boundary or use the evidence already gathered.',
            );
            $emit(AgentEvent::toolCall($call->id, $definition->name, $arguments, ToolDefinition::RISK_SAFE));
            $emit(AgentEvent::toolResult(
                $call->id,
                $definition->name,
                false,
                $result->summary(),
                outcome: $result->outcome,
            ));
            $this->pushToolResult($context, $call, $result);
            $this->requireConclusion($context, $result);

            return 'concluding';
        }

        if ($isDiscovery) {
            ++$context->discoveryCallsInARow;
        } else {
            $context->discoveryCallsInARow = 0;
        }

        if ($definition->name !== SharedTools::BATCH) {
            $refusal = $this->identifierEvidence->validate($context, $definition, $arguments);
            if ($refusal !== null) {
                return $this->refuseInvariant(
                    $context,
                    $call,
                    $definition,
                    $refusal,
                    'identifier_evidence:' . $definition->name,
                    $emit,
                );
            }
        }

        if ($definition->name !== SharedTools::BATCH && !$this->executionPolicy->permits($context, $definition)) {
            return $this->refuseInvariant(
                $context,
                $call,
                $definition,
                $this->executionPolicy->refusal($context, $definition),
                'execution_policy:read_only',
                $emit,
                'I stopped because this diagnosis-only turn repeatedly attempted to make a change.',
            );
        }

        // `files_write` is a text editor, not an upload primitive. Enforce that
        // before risk calculation, live-file attestation or an approval card so
        // a model cannot turn base64 text into a pretend jar/archive write.
        if ($definition->name === 'files_write') {
            $refusal = $this->fileWriteProposalRefusal(
                (string) ($arguments['file'] ?? ''),
                (string) ($arguments['content'] ?? ''),
            );
            if ($refusal !== null) {
                $this->pushToolRefusal($context, $call, $definition, $refusal, $emit);

                return 'continued';
            }
        }

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
                    if (!$this->executionPolicy->permits($context, $childDefinition)) {
                        return $this->refuseInvariant(
                            $context,
                            $call,
                            $definition,
                            $this->executionPolicy->refusal($context, $childDefinition),
                            'execution_policy:read_only',
                            $emit,
                            'I stopped because this diagnosis-only turn repeatedly attempted to make a change.',
                        );
                    }

                    $refusal = $this->identifierEvidence->validate(
                        $context,
                        $childDefinition,
                        $child['arguments'],
                    );
                    if ($refusal !== null) {
                        return $this->refuseInvariant(
                            $context,
                            $call,
                            $definition,
                            $refusal,
                            'identifier_evidence:' . $childDefinition->name,
                            $emit,
                        );
                    }

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
            $refusal = $this->suspend($context, $call, $definition, $arguments, $risk, $emit);
            if ($refusal !== null) {
                $this->pushToolRefusal($context, $call, $definition, $refusal, $emit);

                return 'continued';
            }

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

        if ($this->requiresConclusion($verdict['result'])) {
            $this->requireConclusion($context, $verdict['result']);

            return 'concluding';
        }

        if ($verdict['halt']) {
            $this->requireConclusion(
                $context,
                $verdict['result'],
                'I could not make further progress because the same operation kept repeating. No additional change was made.',
            );

            return 'concluding';
        }

        return 'continued';
    }

    protected function requiresConclusion(ToolResult $result): bool
    {
        return in_array($result->code, [
            'capability_unavailable',
            'discovery_exhausted',
            'question_limit',
            'session_already_open',
            'tool_disabled',
            'tool_not_permitted',
        ], true);
    }

    protected function requireConclusion(
        AgentContext $context,
        ToolResult $result,
        ?string $fallback = null,
    ): void {
        $detail = trim((string) $result->detail);
        $context->requireConclusion(
            $detail !== ''
                ? $detail
                : 'A host-enforced boundary stopped further tool execution.',
            $fallback ?? ($detail !== ''
                ? $detail
                : 'The panel stopped further tool execution at a safety boundary. No additional change was made.'),
        );
    }

    /**
     * Let go of a pin whose work is done. An unreleased pin is a slow leak — by
     * step eight a small budget is full of tools finished with steps ago.
     * Released only on success and only for reads: a successful write may be
     * part of a sequence, a failed read is likely retried.
     *
     * Gateways are never released this way — `admin_assist_server` succeeding is
     * the moment its tools become reachable.
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
     * Explain a call for a tool that was not on this step's list. Four distinct
     * situations get four messages: told a tool does not exist a model stops
     * trying, told it needs a session it opens one.
     *
     * The commonest case is *recovered from* rather than reported — a permitted,
     * enabled tool reached for from memory is pinned and the model told to retry,
     * skipping a redundant `search_tools` round trip for a name it had right.
     * Memory is never authority: a name that resolves but is not permitted, or
     * that an operator disabled, stays refused.
     */
    protected function unofferedCall(AgentContext $context, ToolCallData $call, ?ToolDefinition $definition): ToolResult
    {
        if ($definition === null) {
            return ToolResult::error(
                'capability_unavailable',
                sprintf(
                    'There is no available tool called "%s" in this authorized session. Do not search for '
                        . 'synonyms or claim the action can be executed. Explain the limitation and label any '
                        . 'panel instructions as manual.',
                    $call->name,
                ),
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
                return ToolResult::error(
                    'prerequisite_required',
                    sprintf('%s is not usable yet. %s Call %s first.', $definition->name, $unmet[0]['reason'], $unmet[0]['tool']),
                    retryable: true,
                    fields: ['requires' => $unmet],
                );
            }

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

        return ToolResult::error(
            'tool_not_loaded',
            sprintf('%s was not loaded yet. It is now — call it again.', $definition->name),
            retryable: true,
        );
    }

    /**
     * Hand the browser the values that were kept out of the request.
     *
     * Runs after every call, not at the end of the turn — the tool row is
     * already on screen, and a privacy handle sitting unresolved for ten
     * seconds is worse than one that never appeared.
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
            $result = ToolResult::error(
                'question_limit',
                'You have already asked as many questions as this turn allows. Make a reasonable '
                    . 'assumption, state the limitation, and give a final answer without offering another choice.',
            );
            $this->pushToolResult($context, $call, $result);
            $this->requireConclusion(
                $context,
                $result,
                'I cannot ask another question in this turn. No additional action was taken.',
            );

            return 'concluding';
        }

        ++$context->questions;

        $this->suspendForQuestion($context, $call, $question, $options, (bool) ($arguments['allow_other'] ?? false), $emit);

        return 'suspended';
    }

    /**
     * Resolve a tool the runner owns rather than dispatching. Public because the
     * resume path runs it too — a host tool that suspended for approval must
     * complete after the click, as a dispatched one does.
     *
     * @param string $approvedRisk the tier this call may run at: resolved fresh
     *                             immediately, or read off the stored pending
     *                             action on resume, the only record of what the
     *                             user agreed to. Used only by the batch runner,
     *                             as the ceiling its children may not exceed.
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
            AdminTools::TICKET_CONTEXT => $this->runCompositeReads($context, $call, [
                'ticket' => ['admin_ticket_view', ['ticket' => (string) ($arguments['ticket'] ?? '')]],
                'messages' => ['admin_ticket_messages', ['ticket' => (string) ($arguments['ticket'] ?? '')]],
            ]),
            ServerTools::DIAGNOSTIC_SNAPSHOT => $this->runCompositeReads($context, $call, [
                'status' => ['server_status', []],
                'recent_activity' => ['activity_recent', []],
                'startup' => ['startup_list', []],
                'minecraft' => ['minecraft_server_info', []],
                'root_files' => ['files_list', ['directory' => '/']],
            ]),
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
     * Execute a small, fixed collection of existing read tools behind one
     * model-facing call. Every child keeps its own authorization, audit row,
     * response shaping, redaction, timeout, and failure result; the facade is
     * convenience, never a new authority path.
     *
     * @param array<string, array{0: string, 1: array<string, mixed>}> $sources
     */
    protected function runCompositeReads(
        AgentContext $context,
        ToolCallData $parent,
        array $sources,
    ): ToolResult {
        $evidence = [];
        $limitations = [];
        $truncated = false;
        $index = 0;

        foreach ($sources as $label => [$tool, $arguments]) {
            $definition = $this->registry->find($tool);

            if ($definition === null || $definition->hostHandled || !$this->usable($context, $definition)) {
                $limitations[$label] = [
                    'error' => 'unavailable',
                    'message' => 'This evidence source is not available with the current scope and permissions.',
                ];
                ++$index;

                continue;
            }

            $validation = $this->registry->validate($definition, $arguments);
            if (!$validation['valid']) {
                $limitations[$label] = [
                    'error' => 'invalid_composite_definition',
                    'message' => implode(' ', $validation['errors']),
                ];
                ++$index;

                continue;
            }

            $digest = substr(hash('sha256', implode("\0", [
                $context->turnId,
                (string) $context->step,
                $parent->id,
                'composite',
            ])), 0, 32);
            $child = new ToolCallData(
                ToolCallData::derivedBatchId($digest, $index),
                $definition->name,
                $validation['value'],
                $parent->id,
                $index,
            );
            $result = $this->runTool(
                $context,
                $child,
                $definition,
                $validation['value'],
                ToolDefinition::RISK_SAFE,
            );

            if ($result->ok) {
                $evidence[$label] = $result->data;
                $truncated = $truncated || $result->truncated;
            } else {
                $limitations[$label] = array_filter([
                    'error' => $result->code,
                    'message' => $result->detail,
                    'retryable' => $result->retryable ?: null,
                ], static fn (mixed $value): bool => $value !== null);
            }

            ++$index;
        }

        if ($evidence === []) {
            return ToolResult::error(
                'diagnostic_sources_unavailable',
                'None of the composite read sources was available. Use a permitted narrow read or report the access boundary.',
                fields: ['limitations' => $limitations],
            );
        }

        return ToolResult::ok(array_filter([
            'evidence' => $evidence,
            'limitations' => $limitations ?: null,
            'complete' => $limitations === [],
            'note' => $limitations === []
                ? 'Use this evidence before requesting narrower reads.'
                : 'Some evidence was unavailable. Do not infer values for the missing sources.',
        ], static fn (mixed $value): bool => $value !== null), $truncated);
    }

    /**
     * Bind this turn to a customer's server. The administrator has already
     * approved it — the tool is WRITE tier, so the call suspended through an
     * approval card. What remains is checking the grant is still real: the
     * capability is re-asked rather than trusted from the offered tool list,
     * since an Access Profile can narrow while a card sits on screen.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function openAssist(AgentContext $context, array $arguments, callable $emit): ToolResult
    {
        // Opening the session is idempotent. A small model often repeats the
        // gateway after it has entered the server phase; requiring a second
        // one-time grant turns that harmless retry into a misleading auth error.
        $activeServer = $context->targetServer();
        if ($context->assist !== null && $activeServer !== null) {
            $requested = trim((string) ($arguments['server'] ?? ''));
            $identifiers = array_values(array_filter([
                isset($activeServer->id) ? (string) $activeServer->id : null,
                isset($activeServer->uuid) ? (string) $activeServer->uuid : null,
                isset($activeServer->uuidShort) ? (string) $activeServer->uuidShort : null,
            ], static fn (?string $value): bool => $value !== null && $value !== ''));

            if ($requested === '' || in_array($requested, $identifiers, true)) {
                return ToolResult::ok([
                    'already_open' => true,
                    'server' => $activeServer->name,
                    'access' => $context->assist->writable ? 'read-write' : 'read-only',
                    'tools' => $context->assist->tools(),
                    'note' => 'This assist session is already open. Continue with the server tools; do not open it again.',
                ]);
            }

            return ToolResult::error(
                'session_already_open',
                sprintf(
                    'An assist session is already open on %s. This turn cannot retarget it to another server.',
                    $activeServer->name,
                ),
            );
        }

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
     * Every child is resolved, checked against what this step offered, and
     * validated against its schema before `suspend()` is reached; any failure
     * refuses the whole batch as one retryable error and no card is drawn.
     *
     * The all-or-nothing rule is the point — a card promising twenty products
     * that fails on the seventh has spent the user's attention on something that
     * did not happen. A card exists only for a batch that will run as shown.
     *
     * @param ToolDefinition[] $offered tools on offer this step, so a name that
     *                                  resolves but was filtered out for this
     *                                  user can't reach the card via a batch
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
     * Run a batch the user has approved, in two passes.
     *
     * The first re-checks everything that could have changed while the card sat
     * on screen — tool still exists, still runnable, tier not raised above what
     * was approved — and refuses the whole batch rather than half-running it.
     *
     * The second dispatches, emitting each call's own `tool_call` and
     * `tool_result` under an id derived from the batch's, so the transcript reads
     * as the individual calls it made. `runTool()` writes one `AiToolCall` per
     * child for the same reason.
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
     * Whether a tool may still be run in this turn. Re-checked at the point of
     * running rather than trusted from when it was offered, since an approval
     * card can sit on screen for minutes.
     *
     * A server-scoped tool reached through an assist session is judged against
     * the *binding*, not the acting user's own access to that server — which
     * they do not have, and which is the point of the binding.
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
        // The normal path persisted canonical arguments at approval time. Do it
        // again at the execution boundary for suspended turns created by an
        // older worker and to keep the Wings request byte-identical to what the
        // browser restored on the approval card.
        $arguments = $this->restoreFileWriteArguments($context, $definition, $arguments);

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
            $result = $definition->shape(
                $this->dispatch($context, $definition, $invocation),
                $arguments,
            );
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
            AdminTools::TICKET_CONTEXT,
            'admin_ticket_view',
            'admin_ticket_messages' => ['ticket', $context->assist->ticketId],
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
    ): ?ToolResult {
        $arguments = $this->attestApprovalArguments($context, $definition, $arguments);
        if ($arguments instanceof ToolResult) {
            return $arguments;
        }

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

        return null;
    }

    /** Replace security-sensitive preview inputs with live server evidence. */
    protected function attestApprovalArguments(
        AgentContext $context,
        ToolDefinition $definition,
        array $arguments,
    ): array|ToolResult {
        $arguments = $this->restoreFileWriteArguments($context, $definition, $arguments);

        if ($definition->name === AdminTools::ASSIST_SERVER) {
            $reference = trim((string) ($arguments['server'] ?? ''));
            $server = $this->assist->resolveServer($reference);

            if ($server === null) {
                // A refusal, not a throw. The reference is model input, and a
                // model that has just asked which server is meant will sometimes
                // answer itself — filling the argument with the ticket number,
                // the customer's name, or the words it used to ask the question.
                // Throwing turned that into a dead turn: the card rendered with
                // no result, the whole conversation ended on "The AI ran into a
                // problem", and the one thing nobody could tell from that is
                // that the answer was simply to name a real server.
                //
                // Returned instead, `suspend()` hands it back as an ordinary
                // failed call the model reads and can act on. It is the same
                // condition `openAssist()` already refuses this way, which until
                // now was unreachable — attestation ran first and threw.
                return ToolResult::error(
                    code: 'not_found',
                    detail: sprintf(
                        'No server matches "%s", so no session was opened and nobody was asked to approve one. '
                        . 'A ticket id, a customer name, or a description of the server is not a server reference.',
                        $reference,
                    ),
                    retryable: true,
                    requires: [[
                        'action' => 'list_servers',
                        'tool' => 'admin_servers_list',
                    ]],
                    next: 'Call admin_servers_list, and use the numeric id or uuid of an exact entry from its result. '
                        . 'If several belong to the customer and the ticket does not say which, ask them.',
                );
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

            // original_content is deliberately absent from the model schema.
            // Add content read directly from Wings before persisting or rendering
            // the approval, bounded to the endpoint's accepted file size.
            try {
                $liveContent = $this->files
                    ->setServer($target)
                    ->getContent($file, \Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest::MAX_CONTENT_BYTES);
            } catch (DaemonConnectionException $exception) {
                // Wings reports a missing path as 404. That is an expected
                // refusal for an existing-file-only editor, not a failed agent
                // turn. Other node failures still bubble to normal error
                // handling because retrying later may genuinely work.
                if ($exception->getStatusCode() !== 404) {
                    throw $exception;
                }

                return $this->missingTextFileRecovery(
                    'file_missing',
                    sprintf('The target text file "%s" does not exist. files_write only edits an existing text file and made no change.', $file),
                    $file,
                );
            }

            if (!$this->isUtf8Text($liveContent)) {
                return $this->unsupportedFileWrite(
                    sprintf('The live target "%s" contains binary bytes or is not valid UTF-8 text. files_write cannot safely edit it, and made no change.', $file),
                );
            }

            $arguments['original_content'] = $liveContent;
        }

        return $arguments;
    }

    /** Restore only server-issued privacy handles in a proposed file body. */
    protected function restoreFileWriteArguments(
        AgentContext $context,
        ToolDefinition $definition,
        array $arguments,
    ): array {
        if ($definition->name !== 'files_write' || !is_string($arguments['content'] ?? null)) {
            return $arguments;
        }

        $arguments['content'] = $this->redactor->restore($arguments['content'], $context->redactions);

        return $arguments;
    }

    /** Enforce the same positive text-file contract as the panel diff service. */
    protected function fileWriteProposalRefusal(string $file, string $content): ?ToolResult
    {
        $path = trim($file);

        if ($path === '') {
            return ToolResult::error(
                'invalid_arguments',
                'files_write needs the exact path of an existing text file.',
                retryable: true,
                next: 'Read or list the relevant directory, then call files_write once with the exact existing text-file path.',
            );
        }

        if (!$this->fileDiffs->isTextFile($path)) {
            $detail = sprintf('The target "%s" is not an allowlisted text-file type. files_write cannot create, upload, download, reconstruct or restore binary, database, world-region, archive or unknown file types, and made no change.', $path);

            // The positive text allowlist above is the guard. This narrower
            // classification only chooses useful recovery guidance: a missing
            // server jar/archive/executable can indicate an incomplete install,
            // while a PNG, world region or database says no such thing.
            return $this->isRuntimeBinaryOrArchive($path)
                ? $this->binaryFileWriteRecovery($detail)
                : $this->unsupportedFileWrite($detail);
        }

        return $this->isUtf8Text($content)
            ? null
            : $this->unsupportedFileWrite(
                sprintf('The proposed replacement for "%s" contains binary control bytes or is not valid UTF-8 text. files_write refused it and made no change.', $path),
            );
    }

    /** Require valid UTF-8 and exclude controls that identify binary payloads. */
    protected function isUtf8Text(string $content): bool
    {
        if (!mb_check_encoding($content, 'UTF-8')) {
            return false;
        }

        // Horizontal tab and CR/LF are the only C0 controls ordinary panel
        // configuration files need. NUL, the remaining C0 range, DEL and C1
        // controls are strong binary signatures even when the bytes happen to
        // form valid UTF-8.
        return preg_match('/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]/u', $content) === 0;
    }

    /** Whether a refused path plausibly represents installation/runtime media. */
    protected function isRuntimeBinaryOrArchive(string $file): bool
    {
        return preg_match('/\.(?:7z|apk|bin|bz2|class|deb|dll|dmg|ear|exe|gz|img|iso|jar|lz4|msi|rar|rpm|so(?:\.\d+)*|tar|tgz|war|wasm|xz|zip|zst)$/i', $file) === 1;
    }

    /** Refuse generic non-text data without inventing an install diagnosis. */
    protected function unsupportedFileWrite(string $detail): ToolResult
    {
        return ToolResult::error(
            code: 'binary_write_unsupported',
            detail: $detail,
            retryable: false,
            next: 'Tell the user no change was made. Do not retry files_write with this target or content; it only edits allowlisted UTF-8 text files. Use an appropriate manual panel workflow outside the assistant if non-text data must be managed.',
        );
    }

    /** Recovery for binary targets and incomplete runtime installations. */
    protected function binaryFileWriteRecovery(string $detail): ToolResult
    {
        return ToolResult::error(
            code: 'binary_write_unsupported',
            detail: $detail,
            retryable: false,
            requires: [
                [
                    'action' => 'restore_backup',
                    'manual' => true,
                    'when' => 'Use a known-good backup when a required binary is damaged or existing server data must be preserved.',
                ],
                [
                    'action' => 'server_reinstall',
                    'manual' => true,
                    'when' => 'Use the panel Reinstall action when the installation is incomplete or no suitable backup exists.',
                ],
            ],
            next: 'Tell the user no change was made. For a missing or damaged required runtime binary, recommend restoring a known-good backup first when data must be preserved; otherwise recommend the panel Reinstall action. Do not retry files_write or claim the file was restored.',
        );
    }

    /** Recovery for an ordinary missing text path, never an install diagnosis. */
    protected function missingTextFileRecovery(string $code, string $detail, string $file): ToolResult
    {
        $parent = dirname($file);
        if ($parent === '.' || $parent === DIRECTORY_SEPARATOR) {
            $parent = '/';
        }

        return ToolResult::error(
            code: $code,
            detail: $detail,
            retryable: false,
            requires: [[
                'action' => 'verify_path',
                'tool' => 'files_list',
                'directory' => $parent,
            ]],
            next: 'List the parent directory and verify the exact path. files_write cannot create a missing file. Do not retry the unchanged path; if the intended text file truly does not exist, tell the user it must be created or uploaded manually outside the assistant.',
        );
    }

    /** Close the live tool row and feed a policy refusal back to the model. */
    protected function pushToolRefusal(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        ToolResult $result,
        callable $emit,
    ): void {
        $emit(AgentEvent::toolResult(
            $call->id,
            $definition->name,
            false,
            $result->summary(),
            outcome: $result->outcome,
        ));

        $this->pushToolResult($context, $call, $result);
    }

    /**
     * Refuse a code-enforced invariant once with corrective guidance, then stop
     * if the very next call attempts the same class of bypass with new values.
     *
     * @param callable(AgentEvent): void $emit
     */
    protected function refuseInvariant(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        ToolResult $result,
        string $family,
        callable $emit,
        string $haltMessage = 'I stopped because I repeatedly tried to use an identifier that no listing had verified.',
    ): string {
        $verdict = $this->progress->evaluateInvariant($context, $family, $result);

        $this->pushToolRefusal($context, $call, $definition, $verdict['result'], $emit);

        if (!$verdict['halt']) {
            return 'continued';
        }

        $this->requireConclusion($context, $verdict['result'], $haltMessage);

        return 'concluding';
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
                'server_uuid' => $sealed['binding'] instanceof AssistBinding
                    ? $sealed['binding']->serverUuid
                    : $context->targetServer()?->uuid,
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
     * Public because three other places must agree with this single
     * definition: `UpdateIntelligenceSettingsRequest`'s validation, the admin
     * form's number input, and the client's idle watchdog. When validation
     * once accepted 15 and this floored at 30, an operator could save a value
     * the agent never actually used.
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
     * Floored at the batch minimum, not at 1 — an operator setting this to
     * zero means "no batching," and the honest way to say that is disabling
     * the tool in the catalogue, not offering one that refuses every call it
     * gets.
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

    /** @phpstan-impure Reads the wall clock through now(). */
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
     * Delegated to `ToolBudget`, which reads `agent:max_tools` if an operator
     * set one, and otherwise derives it from the model. This used to default
     * to 32 for everyone — a guess made once on behalf of every deployment,
     * and a bad one for the small local models the panel is often run
     * against.
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
