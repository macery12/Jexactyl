<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Services\AI\Data\AiMessage;

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

    public function push(AiMessage $message): void
    {
        $this->messages[] = $message;
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
