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
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\ToolCallSalvager;
use Everest\Exceptions\Service\AI\AIServiceException;
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

            $definitions = $this->registry->forServer($context->user, $context->server, $context->activeGroups);
            $groups = $this->registry->availableGroups($context->user, $context->server, $context->activeGroups);
            $tools = $this->capTools($this->registry->toAiTools($definitions, $groups));

            $response = $this->callModel($context, $tools, $emit);

            $calls = $response['calls'];
            $text = $response['text'];

            // Nothing structured came back. If the text looks like a botched
            // call, spend a repair round under a schema-constrained grammar
            // rather than throwing away the step.
            if ($calls === [] && $this->shouldRepair($context, $text)) {
                ++$context->repairs;
                $calls = $this->repair($context, $tools, $text);
            }

            if ($calls === []) {
                $context->push(AiMessage::assistant($text));
                $emit(AgentEvent::done('complete'));

                return;
            }

            $context->push(AiMessage::assistant($text !== '' ? $text : null, $calls));

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
     * One model call. Text streams straight through; tool calls are collected.
     *
     * @param AiTool[] $tools
     * @param callable(AgentEvent): void $emit
     *
     * @return array{text: string, calls: ToolCallData[]}
     */
    protected function callModel(AgentContext $context, array $tools, callable $emit): array
    {
        $provider = $this->factory->make(ProviderFactory::TASK_AGENT);

        $request = new AiRequest(
            messages: $context->messages,
            systemPrompt: $this->promptBuilder->build($context),
            tools: $tools,
            // Tool selection benefits from determinism far more than prose
            // does; the configured temperature applies to the final answer.
            temperature: $tools !== [] ? 0.0 : null,
        );

        $text = '';
        $calls = [];

        foreach ($provider->stream($request) as $event) {
            switch ($event->type) {
                case AiStreamEvent::TYPE_TEXT:
                    $text .= (string) $event->text;
                    $emit(AgentEvent::text((string) $event->text));
                    break;

                case AiStreamEvent::TYPE_TOOL_CALL:
                    if ($event->toolCall !== null) {
                        $calls[] = $event->toolCall;
                    }
                    break;

                case AiStreamEvent::TYPE_ERROR:
                    throw new AIServiceException((string) $event->error);
            }
        }

        return ['text' => $text, 'calls' => $calls];
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
                systemPrompt: $this->promptBuilder->build($context),
                tools: $tools,
                temperature: 0.0,
            ))->withResponseSchema($this->salvager->repairSchema($tools));

            $repaired = '';
            foreach ($provider->stream($request) as $event) {
                if ($event->type === AiStreamEvent::TYPE_TEXT) {
                    $repaired .= (string) $event->text;
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

            $this->pushToolResult($context, $call, ToolResult::ok(['activated' => $group]));

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
        $risk = $this->riskGate->resolve($definition, $arguments);

        $emit(AgentEvent::toolCall($call->id, $definition->name, $arguments, $risk));

        if (!$this->riskGate->runsAutomatically($risk)) {
            $this->suspend($context, $call, $definition, $arguments, $risk, $emit);

            return 'suspended';
        }

        $result = $this->runTool($context, $call, $definition, $arguments, $risk);
        $emit(AgentEvent::toolResult($call->id, $definition->name, $result->ok, $result->summary()));
        $this->pushToolResult($context, $call, $result);

        return 'continued';
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
        $record = AiToolCall::create([
            'turn_id' => $context->turnId,
            'conversation_id' => $context->conversationId,
            'user_id' => $context->user->id,
            'server_uuid' => $context->server->uuid,
            'tool_name' => $definition->name,
            'risk' => $risk,
            'step' => $context->step,
            'arguments' => $arguments,
            'status' => AiToolCall::STATUS_RUNNING,
        ]);

        $startedAt = microtime(true);

        $invocation = $definition->invoke($arguments, $this->registry->serverContext($context->server, $arguments));
        $result = $definition->shape($this->executor->execute($invocation, $this->toolResultBytes()));

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
        AiPendingAction::updateOrCreate(
            ['turn_id' => $context->turnId],
            [
                'conversation_id' => $context->conversationId,
                'user_id' => $context->user->id,
                'server_uuid' => $context->server->uuid,
                'tool_name' => $definition->name,
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

        AiToolCall::create([
            'turn_id' => $context->turnId,
            'conversation_id' => $context->conversationId,
            'user_id' => $context->user->id,
            'server_uuid' => $context->server->uuid,
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
     * Keep the offered set small. Local models degrade sharply past roughly
     * fifteen tools, and the base set is ordered most-useful-first so a cap
     * drops the least relevant.
     *
     * @param AiTool[] $tools
     *
     * @return AiTool[]
     */
    protected function capTools(array $tools): array
    {
        $max = $this->maxTools();

        return count($tools) <= $max ? $tools : array_slice($tools, 0, $max);
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
        return max(4, (int) $this->setting('agent:max_tools', config('modules.ai.agent.max_tools', 15)));
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
