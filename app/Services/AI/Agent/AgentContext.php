<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiToolCall;

/**
 * Everything one turn needs, and the state that has to survive a suspension.
 *
 * The server is bound here from the route the turn was opened on. Nothing in
 * the turn can change it — that binding is what confines the agent to a single
 * server regardless of what the model asks for.
 */
class AgentContext
{
    /** @var AiMessage[] */
    public array $messages = [];

    /** @var string[] */
    public array $activeGroups = [];

    public int $step = 0;

    public int $repairs = 0;

    private ?TurnRecorder $recorder = null;

    public function __construct(
        public readonly User $user,
        public readonly Server $server,
        public readonly string $turnId,
        public readonly ?int $conversationId = null,
        public readonly ?string $consoleBuffer = null,
    ) {
    }

    /**
     * @param AiMessage[] $messages
     */
    public function withMessages(array $messages): self
    {
        $this->messages = $messages;

        return $this;
    }

    /**
     * Persist every message pushed from here on.
     *
     * Deliberately attached after any replayed history is loaded, so resuming a
     * suspended turn does not write its earlier half a second time.
     */
    public function withRecorder(?TurnRecorder $recorder): self
    {
        $this->recorder = $recorder;

        return $this;
    }

    /**
     * @param string|null $persistAs stored instead of the model-facing content,
     *                               for messages whose wire form is far larger
     *                               than what the transcript needs
     */
    public function push(AiMessage $message, ?string $persistAs = null): void
    {
        $this->messages[] = $message;

        $this->recorder?->record($this->conversationId, $message, $this->step, $persistAs);
    }

    /**
     * The tool calls from the most recent assistant turn that still have no
     * result.
     *
     * Every provider requires each tool call to be answered before the
     * conversation can continue — Anthropic rejects the request outright if a
     * `tool_use` block has no matching `tool_result`. A turn that suspends
     * partway through a batch of parallel calls leaves exactly that gap: the
     * calls after the one awaiting approval never ran, so on resume they have
     * to be closed out rather than silently dropped.
     *
     * @return AiToolCall[]
     */
    public function unresolvedToolCalls(): array
    {
        $calls = [];

        // Walk back to the last assistant message that asked for tools, taking
        // note of every result seen on the way — those are its answers.
        $answered = [];

        for ($i = count($this->messages) - 1; $i >= 0; --$i) {
            $message = $this->messages[$i];

            if ($message->role === AiMessage::ROLE_TOOL) {
                if ($message->toolCallId !== null) {
                    $answered[$message->toolCallId] = true;
                }

                continue;
            }

            if ($message->role === AiMessage::ROLE_ASSISTANT && $message->toolCalls !== []) {
                $calls = $message->toolCalls;
            }

            break;
        }

        return array_values(array_filter($calls, fn (AiToolCall $call) => !isset($answered[$call->id])));
    }

    /**
     * Serialise the resumable parts of the turn.
     *
     * Only the model-visible conversation and the loop counters: the user and
     * server are re-resolved and re-authorized on resume rather than trusted
     * from stored state.
     */
    public function toState(): array
    {
        return [
            'messages' => array_map(fn (AiMessage $m) => $m->toArray(), $this->messages),
            'active_groups' => $this->activeGroups,
            'step' => $this->step,
            'repairs' => $this->repairs,
            'console_buffer' => $this->consoleBuffer,
        ];
    }

    public static function fromState(User $user, Server $server, string $turnId, ?int $conversationId, array $state): self
    {
        $context = new self(
            $user,
            $server,
            $turnId,
            $conversationId,
            is_string($state['console_buffer'] ?? null) ? $state['console_buffer'] : null,
        );

        $context->messages = array_map(
            fn (array $m) => AiMessage::fromArray($m),
            is_array($state['messages'] ?? null) ? $state['messages'] : []
        );
        $context->activeGroups = array_values(array_filter(
            is_array($state['active_groups'] ?? null) ? $state['active_groups'] : [],
            'is_string'
        ));
        $context->step = (int) ($state['step'] ?? 0);
        $context->repairs = (int) ($state['repairs'] ?? 0);

        return $context;
    }
}
