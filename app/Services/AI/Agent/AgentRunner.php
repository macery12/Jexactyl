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
use Everest\Repositories\Wings\DaemonFileRepository;
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
        private DaemonFileRepository $files,
    ) {
    }

    /**
     * Run a turn, emitting events as it goes.
     *
     * @param callable(AgentEvent): void $emit
     */
    public function run(AgentContext $context, callable $emit): void
    {
        $startedAt = $this->now();
        $this->beginDeadline($context, $startedAt);
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
        } catch (\Throwable $e) {
            Log::error('AI agent turn failed: ' . $e->getMessage(), ['turn' => $context->turnId]);

            // Finalization belongs to the stream owner. Swallowing here made
            // the controller mark usage and an approved pending action as
            // successful even though the only terminal event was an error.
            throw $e;
        } finally {
            LogBatch::end();
            $lease?->release();

            $elapsed = (int) round(($this->now() - $startedAt) * 1000);
            $this->gate->recordTurnDuration($elapsed);
        }
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
            if ($this->now() >= $deadline) {
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
            $groups = $this->groupsInPlay(
                $context,
                fn (array $active) => $this->registry->forServer($context->user, $context->server, $active),
                array_keys($this->registry->availableGroups($context->user, $context->server)),
            );

            return [
                $this->registry->forServer($context->user, $context->server, $groups),
                $this->registry->availableGroups($context->user, $context->server, $groups),
            ];
        }

        // Nothing to widen until a session exists, and a tool the model cannot
        // use is a tool it will try anyway.
        $offer = fn (array $active) => array_values(array_filter(
            $this->registry->forAdmin($context->user, $active),
            fn (ToolDefinition $d) => $d->name !== AdminTools::ASSIST_ALLOW_WRITES
        ));

        if ($context->assist !== null && $context->targetServer() !== null) {
            // A session names its tools outright, so there is no group
            // indirection left to flatten — `assistOfferings()` has already
            // settled what this session is for.
            return [
                $this->assistOfferings($context),
                $this->registry->availableAdminGroups($context->user, $context->activeGroups),
            ];
        }

        $groups = $this->groupsInPlay(
            $context,
            $offer,
            array_keys($this->registry->availableAdminGroups($context->user)),
        );

        return [$offer($groups), $this->registry->availableAdminGroups($context->user, $groups)];
    }

    /**
     * Which groups count as active this step.
     *
     * Groups exist because small local models degrade sharply once too many
     * schemas are in play, and the way out of that is to show fewer. But the
     * indirection is not free, and it is paid on every turn that needs a grouped
     * tool: the model has to infer from a one-line description which group holds
     * what it wants, spend a step loading it, and only then make the call it
     * meant to make in the first place. It also has to decide it needs a tool it
     * cannot see, which is the part models are worst at — a tool that is absent
     * and a tool that does not exist look identical from the inside, and the
     * usual outcome is the model saying it cannot do something it can.
     *
     * So the indirection is now a *fallback* rather than the architecture. When
     * the whole catalogue fits inside the cap, every group is treated as already
     * active: the model sees every tool by name and simply calls the one it
     * wants. `availableGroups()` then returns nothing left to load, so
     * `toAiTools()` never appends the meta-tool and the system prompt drops its
     * paragraph about it — nothing anywhere mentions a mechanism this turn does
     * not use. Only when the catalogue genuinely does not fit — an operator who
     * lowered `max_tools` for a 7B model — do groups come back, and then they are
     * doing the job they were designed for rather than taxing turns that never
     * needed them.
     *
     * @param callable(string[]): ToolDefinition[] $offer the tools on offer with a given set of groups active
     * @param string[] $everyGroup every group this user could reach on this surface
     *
     * @return string[]
     */
    private function groupsInPlay(AgentContext $context, callable $offer, array $everyGroup): array
    {
        if ($everyGroup === []) {
            return $context->activeGroups;
        }

        $budget = 0;
        foreach ($offer($everyGroup) as $definition) {
            if (!in_array($definition->name, self::UNCAPPED_TOOLS, true)) {
                ++$budget;
            }
        }

        return $budget <= $this->maxTools() ? $everyGroup : $context->activeGroups;
    }

    /**
     * The tools on offer once an assist session is open.
     *
     * Narrower than "admin tools plus server tools", and deliberately so. The
     * offered set is capped because local models degrade past roughly fifteen
     * tools, and the two sets together comfortably exceed it — so rather than
     * let the cap truncate an arbitrary tail, this states what a diagnostic
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
     * either phase outgrows the cap, because the alternative is the cap silently
     * dropping the tail at exactly the point a session starts changing things.
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

        // A binding opened without a ticket has no ticket subject. Keeping the
        // panel-wide ticket readers in that phase would leave any model-chosen
        // ticket id looking like an ordinary automatic read.
        if ($binding->ticketId === null) {
            $companions = array_values(array_diff($companions, [
                'admin_ticket_view',
                'admin_ticket_messages',
            ]));
        }

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
            default => ToolResult::error(
                'unknown_tool',
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
            // seen anything on that server. `activate_tool_group` never resolves
            // here at all, so it is caught above as an unknown name.
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

    /**
     * Tools that are never subject to the cap.
     *
     * `ask_user` is the agent's way out of a position it cannot otherwise leave,
     * and `batch` is how it makes more than one change without asking the user
     * twenty times; neither is a capability, so spending cap budget on them
     * defeats the mechanism the budget exists to serve. `activate_tool_group`
     * needs no entry here: the registry appends it after the cap has already
     * run, in `toAiTools()`.
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
        SharedTools::BATCH,
    ];

    /**
     * Keep the offered set small. Local models degrade sharply once too many
     * tools are in play — a 3B model given twenty schemas tends to call the
     * first one that parses rather than the one that fits.
     *
     * Inert on a default install, and that is the intent: `groupsInPlay()` only
     * withholds a group once the catalogue has already overrun the cap, so by
     * the time anything reaches here under normal settings it fits. What follows
     * is the behaviour after an operator has lowered `max_tools` far enough that
     * something genuinely has to go.
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

    protected function maxTools(): int
    {
        return max(4, (int) $this->setting('agent:max_tools', config('modules.ai.agent.max_tools', 32)));
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
