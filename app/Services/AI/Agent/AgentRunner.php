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
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\ToolInvocation;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\ToolCallSalvager;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;

/**
 * Drives one agent turn: model call, tool calls, repeat.
 *
 * The loop is bounded three ways — steps, wall clock, and the inference gate's
 * lease — because an agent that misjudges a task can otherwise spend a GPU
 * indefinitely. It ends when the model stops asking for tools, when a bound is
 * hit, or when it needs a human decision, which suspends rather than blocks.
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
    ) {
    }

    /**
     * Run a turn, emitting events as it goes.
     *
     * @param callable(AgentEvent): void $emit
     */
    public function run(AgentContext $context, callable $emit): void
    {
        $startedAt = microtime(true);
        $lease = null;

        try {
            $lease = $this->gate->acquire(
                $context->user->uuid,
                $context->step > 0 ? InferenceGate::LANE_RESUME : InferenceGate::LANE_NEW,
                fn (int $position, int $ahead, int $eta) => $emit(AgentEvent::queued($position, $ahead, $eta)),
            );

            // One batch id across the turn, so every activity row a tool
            // produces traces back to the conversation that caused it.
            LogBatch::start();

            $this->loop($context, $emit, $startedAt);
        } catch (AIServiceException $e) {
            $emit(AgentEvent::error($e->getMessage()));
        } catch (\Throwable $e) {
            Log::error('AI agent turn failed: ' . $e->getMessage(), ['turn' => $context->turnId]);
            $emit(AgentEvent::error('The AI ran into a problem. Please try again.'));
        } finally {
            LogBatch::end();
            $lease?->release();

            $elapsed = (int) round((microtime(true) - $startedAt) * 1000);
            $this->gate->recordTurnDuration($elapsed);
        }
    }

    /**
     * @param callable(AgentEvent): void $emit
     */
    protected function loop(AgentContext $context, callable $emit, float $startedAt): void
    {
        $maxSteps = $this->maxSteps();
        $deadline = $startedAt + $this->maxWallSeconds();

        while ($context->step < $maxSteps) {
            if (microtime(true) >= $deadline) {
                $emit(AgentEvent::done('time_limit'));

                return;
            }

            ++$context->step;
            $emit(AgentEvent::step($context->step, $maxSteps));

            // Capped before conversion, not after: the cap has to tell a base
            // tool from a grouped one, and an AiTool has dropped that by the
            // time it is wire-shaped. `toAiTools()` appends the group meta-tool
            // afterwards, which is what keeps it out of the budget.
            [$definitions, $groups] = $this->offerings($context);
            $definitions = $this->capDefinitions($context, $definitions);
            $tools = $this->registry->toAiTools($definitions, $groups);

            $response = $this->callModel($context, $tools, $emit);

            $calls = $response['calls'];
            $text = $response['text'];
            $reasoning = $response['reasoning'];

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

                    $emit(AgentEvent::error(
                        'The model tried to use a tool but could not write the request correctly. '
                            . 'This usually means the model is too small for the number of tools it was '
                            . 'offered — try again, or ask an administrator to lower the tool limit.'
                    ));

                    return;
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
                $outcome = $this->handleCall($context, $call, $definitions, $emit);

                if ($outcome === 'suspended') {
                    return;
                }
            }
        }

        $emit(AgentEvent::done('step_limit'));
    }

    /**
     * The tools and groups on offer this step, for whichever surface the turn
     * is bound to.
     *
     * @return array{0: ToolDefinition[], 1: array<string, string>}
     */
    protected function offerings(AgentContext $context): array
    {
        if ($context->server !== null) {
            return [
                $this->registry->forServer($context->user, $context->server, $context->activeGroups),
                $this->registry->availableGroups($context->user, $context->server, $context->activeGroups),
            ];
        }

        $definitions = $this->registry->forAdmin($context->user, $context->activeGroups);
        $groups = $this->registry->availableAdminGroups($context->user, $context->activeGroups);

        if ($context->assist !== null && $context->targetServer() !== null) {
            return [$this->assistOfferings($context), $groups];
        }

        // Nothing to widen until a session exists, and a tool the model cannot
        // use is a tool it will try anyway.
        return [
            array_values(array_filter(
                $definitions,
                fn (ToolDefinition $d) => $d->name !== AdminTools::ASSIST_ALLOW_WRITES
            )),
            $groups,
        ];
    }

    /**
     * The tools on offer once an assist session is open.
     *
     * Narrower than "admin tools plus server tools", and deliberately so. The
     * offered set is capped because local models degrade past roughly fifteen
     * tools, and the two sets together comfortably exceed it — so rather than
     * let `capTools()` truncate an arbitrary tail, this states what a diagnostic
     * session is actually for. The server's own tools come first because they
     * are the point; the handful of admin tools that survive are the ones that
     * answer a question *about* this server or the person who reported it.
     * Panel-wide browsing is not part of the job and comes back the moment the
     * session is not the subject.
     *
     * Escalating narrows it further, because the server side grows and the cap
     * does not. The two assist tools go first, having run out of meaning — there
     * is no wider grant left to ask for, and the tool that opens a session is
     * noise while one is open on the very server the turn is about — and the
     * panel records go with them, for the reason given on
     * `AssistBinding::WRITABLE_COMPANION_TOOLS`. `AssistSessionTest` fails if
     * either phase outgrows the cap, because the alternative is `capTools()`
     * silently dropping the tail at exactly the point a session starts changing
     * things.
     *
     * @return ToolDefinition[]
     */
    protected function assistOfferings(AgentContext $context): array
    {
        $binding = $context->assist;

        $companions = $binding->writable
            ? AssistBinding::WRITABLE_COMPANION_TOOLS
            : array_merge(
                AssistBinding::COMPANION_TOOLS,
                [AdminTools::ASSIST_SERVER, AdminTools::ASSIST_ALLOW_WRITES]
            );

        $offered = array_filter(
            $this->registry->forAdmin($context->user, $context->activeGroups),
            fn (ToolDefinition $d) => in_array($d->name, $companions, true)
                // A session that cannot ask which of two fixes to apply will
                // pick one, on someone else's server.
                || $d->scope === ToolDefinition::SCOPE_SHARED
        );

        return array_merge(
            $this->registry->forAssist($binding->tools(), $binding->abilities),
            array_values($offered),
        );
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
        $provider = $this->factory->make(ProviderFactory::TASK_AGENT);

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
            $provider = $this->factory->make(ProviderFactory::TASK_AGENT);

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
        // The group meta-tool is handled in-process: it changes what the next
        // step is offered rather than touching the panel at all.
        if ($call->name === ToolRegistry::META_ACTIVATE_GROUP) {
            $group = (string) ($call->arguments['group'] ?? '');
            if ($group !== '' && !in_array($group, $context->activeGroups, true)) {
                $context->activeGroups[] = $group;
            }

            $this->pushToolResult($context, $call, ToolResult::ok($this->activationReport($context, $group)));

            return 'continued';
        }

        $definition = $this->registry->find($call->name);

        // Only tools offered this turn are runnable. A name that resolves in
        // the registry but was filtered out for this user must not slip
        // through on a hallucinated call.
        $offered = false;
        foreach ($definitions as $candidate) {
            if ($candidate->name === $call->name) {
                $offered = true;
                break;
            }
        }

        if ($definition === null || !$offered) {
            $this->pushToolResult($context, $call, ToolResult::error(
                'unknown_tool',
                sprintf('There is no tool called "%s" available here.', $call->name),
            ));

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

        $risk = $this->riskGate->resolve($definition, $arguments);

        $emit(AgentEvent::toolCall($call->id, $definition->name, $arguments, $risk));

        if (!$this->riskGate->runsAutomatically($risk)) {
            $this->suspend($context, $call, $definition, $arguments, $risk, $emit);

            return 'suspended';
        }

        $startedAt = microtime(true);
        $result = $definition->hostHandled
            ? $this->runHostTool($context, $call, $definition, $arguments, $emit)
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
            $result->ok ? $result->data : null,
            (int) round((microtime(true) - $startedAt) * 1000),
        ));

        $this->pushToolResult($context, $call, $result);

        return 'continued';
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
     * @param callable(AgentEvent): void $emit
     */
    public function runHostTool(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        array $arguments,
        callable $emit,
    ): ToolResult {
        return match ($definition->name) {
            AdminTools::ASSIST_SERVER => $this->openAssist($context, $arguments, $emit),
            AdminTools::ASSIST_ALLOW_WRITES => $this->escalateAssist($context, $arguments, $emit),
            default => ToolResult::error(
                'unknown_tool',
                sprintf('There is no tool called "%s" available here.', $definition->name),
            ),
        };
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
        if (!$this->assist->permitted($context->user)) {
            return ToolResult::error(
                'forbidden',
                'You do not have permission to open a session on a customer\'s server. That needs the '
                    . '"servers.assist" capability. Say so and stop.',
            );
        }

        $server = $this->assist->resolveServer((string) ($arguments['server'] ?? ''));

        if ($server === null) {
            return ToolResult::error(
                'not_found',
                'No server matches that id. List the customer\'s servers and use an id from the result.',
                retryable: true,
            );
        }

        $binding = new AssistBinding(
            serverUuid: $server->uuid,
            serverName: (string) $server->name,
            reason: trim((string) ($arguments['reason'] ?? '')),
            ticketId: isset($arguments['ticket']) && is_numeric($arguments['ticket'])
                ? (int) $arguments['ticket']
                : null,
        );

        $context->bindAssist($binding, $server);
        $this->assist->record($context->user, $server, $binding);

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
        $binding = $context->assist->escalated();

        $context->bindAssist($binding, $server);
        $this->assist->record($context->user, $server, $binding, escalation: true);

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

    /**
     * Execute an approved or automatic call and record it for audit.
     */
    public function runTool(
        AgentContext $context,
        ToolCallData $call,
        ToolDefinition $definition,
        array $arguments,
        string $risk,
    ): ToolResult {
        // A server-scoped tool records the server it actually touched, which
        // during an assist session is the customer's rather than none at all —
        // the audit trail is the whole justification for the feature.
        $target = $context->targetServer();
        $subject = $definition->scope === ToolDefinition::SCOPE_SERVER ? $target : $context->server;

        $record = AiToolCall::create([
            'turn_id' => $context->turnId,
            'conversation_id' => $context->conversationId,
            'user_id' => $context->user->id,
            'server_uuid' => $subject?->uuid,
            'scope' => $context->scope(),
            'tool_name' => $definition->name,
            'risk' => $risk,
            'step' => $context->step,
            'arguments' => $arguments,
            'status' => AiToolCall::STATUS_RUNNING,
        ]);

        $startedAt = microtime(true);

        $invocation = $definition->invoke(
            $arguments,
            $this->registry->contextForTool($definition, $target, $arguments)
        );

        $result = $definition->shape($this->dispatch($context, $definition, $invocation));
        $result = $this->redact($context, $result);

        $record->update([
            'status' => $result->ok ? AiToolCall::STATUS_SUCCEEDED : AiToolCall::STATUS_FAILED,
            'http_status' => $result->status,
            'result_summary' => $result->summary(),
            'duration_ms' => (int) round((microtime(true) - $startedAt) * 1000),
            'resolved_at' => now(),
        ]);

        return $result;
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
        $run = fn () => $this->executor->execute($invocation, $this->toolResultBytes());

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
        if (!$result->ok) {
            return $result;
        }

        $redacted = $this->redactor->redact($result->data, $context->redactions);

        return $redacted === $result->data
            ? $result
            : ToolResult::ok($redacted, $result->truncated);
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
        $this->persistPending($context, $call, $definition->name, $arguments, $risk);

        AiToolCall::create([
            'turn_id' => $context->turnId,
            'conversation_id' => $context->conversationId,
            'user_id' => $context->user->id,
            // The server this call will actually touch, which during an assist
            // session is the customer's rather than none at all. Reading
            // `$context->server` here recorded null on exactly the calls that
            // most need attributing: an admin turn has no bound server by
            // construction, so every approval-gated write on somebody else's
            // machine was audited against nothing.
            'server_uuid' => $context->targetServer()?->uuid,
            'scope' => $context->scope(),
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
            ApprovalPreview::for($definition->name, $arguments),
        ));
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
        AiPendingAction::updateOrCreate(
            ['turn_id' => $context->turnId],
            [
                'conversation_id' => $context->conversationId,
                'user_id' => $context->user->id,
                // See `suspend()`: the server the pending call is against, not
                // the surface's own binding.
                'server_uuid' => $context->targetServer()?->uuid,
                'scope' => $context->scope(),
                'tool_name' => $toolName,
                // The model's own id for this call. Resuming has to answer with
                // the same one — a fabricated id is rejected by every provider.
                'tool_call_id' => $call->id,
                'risk' => $risk,
                'arguments' => $arguments,
                'state' => $context->toState(),
                'step' => $context->step,
                'status' => AiPendingAction::STATUS_PENDING,
                'expires_at' => now()->addMinutes(AiPendingAction::EXPIRY_MINUTES),
            ]
        );
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
            TurnRecorder::toolDisplay($result->ok, $result->summary()),
        );
    }

    /**
     * Tools that are never subject to the cap.
     *
     * `ask_user` is the agent's way out of a position it cannot otherwise leave,
     * so spending cap budget on it defeats the mechanism the budget exists to
     * serve. `activate_tool_group` needs no entry here: the registry appends it
     * after the cap has already run, in `toAiTools()`.
     *
     * Ordering these last and letting `array_slice()` take the tail meant that
     * on a server turn with a fully-permissioned user the offered set came to
     * exactly one over the cap, and the tool that was dropped was
     * `activate_tool_group` — so every grouped tool became unreachable, on the
     * surface where most of them live. It failed upward, too: a user with fewer
     * permissions offered fewer tools, came in under the cap, and kept the
     * meta-tool the owner had lost.
     */
    private const UNCAPPED_TOOLS = [
        SharedTools::ASK_USER,
    ];

    /**
     * Keep the offered set small. Local models degrade sharply once too many
     * tools are in play — a 3B model given twenty schemas tends to call the
     * first one that parses rather than the one that fits.
     *
     * **The base set is reserved; only groups are capped.** Those two halves
     * fail differently and that asymmetry is the whole design. A missing read is
     * indistinguishable to the model from a capability the panel does not have,
     * so it stops and says it cannot help — while a group that only partly
     * loaded is a fact the model can be *told*, and `activationReport()` tells
     * it. One failure is silent and terminal, the other is legible and
     * recoverable, so the budget is spent on the side that can recover.
     *
     * The base set overrunning the cap on its own is a real configuration — an
     * operator who set `max_tools` to 8 for a small model — and there is no good
     * answer to it, so it truncates and warns rather than quietly exceeding what
     * the operator asked for.
     *
     * @param ToolDefinition[] $definitions
     *
     * @return ToolDefinition[]
     */
    protected function capDefinitions(AgentContext $context, array $definitions): array
    {
        $max = $this->maxTools();

        $reserved = [];
        $base = [];
        $grouped = [];

        foreach ($definitions as $definition) {
            if (in_array($definition->name, self::UNCAPPED_TOOLS, true)) {
                $reserved[] = $definition;
            } elseif ($definition->group === null) {
                $base[] = $definition;
            } else {
                $grouped[] = $definition;
            }
        }

        if (count($base) > $max) {
            $this->warnCap($context, $max, array_slice($base, $max));

            return array_merge(array_slice($base, 0, $max), $reserved);
        }

        $room = $max - count($base);

        if (count($grouped) > $room) {
            $this->warnCap($context, $max, array_slice($grouped, $room));
        }

        return array_merge($base, array_slice($grouped, 0, $room), $reserved);
    }

    /**
     * Say once per turn that the cap bit, and on what.
     *
     * Latched on the context because `capDefinitions()` runs per step: an
     * over-cap turn would otherwise write the same warning up to twelve times.
     * Silence is not an option either — it is how the truncation went unnoticed
     * in the first place, since the model simply behaves as though a capability
     * does not exist, which reads exactly like it not being configured.
     *
     * @param ToolDefinition[] $dropped
     */
    private function warnCap(AgentContext $context, int $max, array $dropped): void
    {
        $names = array_map(fn (ToolDefinition $d) => $d->name, $dropped);
        $signature = implode(',', $names);

        if (in_array($signature, $context->capWarnings, true)) {
            return;
        }

        $context->capWarnings[] = $signature;

        Log::warning(sprintf(
            'AI agent tool cap reached (max_tools=%d): dropped %d tool(s) — %s',
            $max,
            count($names),
            implode(', ', $names)
        ));
    }

    /**
     * What activating a group actually loaded.
     *
     * The model is told rather than left to infer, because the alternative is
     * indistinguishable from the activation having failed: it asks for
     * "backups", the next step offers no backup tools, and the only conclusion
     * available to it is that the panel is broken. Naming what did not fit also
     * gives it something to act on — dropping a group it no longer needs is a
     * move it can make, and cannot make blind.
     *
     * @return array<string, mixed>
     */
    protected function activationReport(AgentContext $context, string $group): array
    {
        [$definitions] = $this->offerings($context);
        $capped = $this->capDefinitions($context, $definitions);

        $loaded = [];
        foreach ($capped as $definition) {
            if ($definition->group === $group) {
                $loaded[] = $definition->name;
            }
        }

        $missing = [];
        foreach ($definitions as $definition) {
            if ($definition->group === $group && !in_array($definition->name, $loaded, true)) {
                $missing[] = $definition->name;
            }
        }

        $report = ['activated' => $group, 'tools' => $loaded];

        if ($missing !== []) {
            $report['not_loaded'] = $missing;
            $report['note'] = 'This turn is at its tool limit, so those did not fit. Use what loaded, or '
                . 'say which one you need and why.';
        }

        return $report;
    }

    /*
    |--------------------------------------------------------------------------
    | Limits
    |--------------------------------------------------------------------------
    */

    public function maxSteps(): int
    {
        return max(1, (int) $this->setting('agent:max_steps', config('modules.ai.agent.max_steps', 12)));
    }

    public function maxWallSeconds(): int
    {
        return max(30, (int) $this->setting('agent:max_wall_seconds', config('modules.ai.agent.max_wall_seconds', 180)));
    }

    protected function maxRepairs(): int
    {
        return max(0, (int) $this->setting('agent:max_repairs', config('modules.ai.agent.max_repairs', 2)));
    }

    protected function maxTools(): int
    {
        return max(4, (int) $this->setting('agent:max_tools', config('modules.ai.agent.max_tools', 20)));
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
