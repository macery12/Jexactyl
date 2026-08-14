<?php

namespace Everest\Services\AI\Data;

/**
 * Provider-agnostic conversation message.
 *
 * Every driver serialises to and from this shape, so the agent loop never has
 * to know whether it is talking to Anthropic's content-block format, OpenAI's
 * Responses API, or an Ollama chat-completions endpoint.
 */
class AiMessage
{
    public const ROLE_SYSTEM = 'system';
    public const ROLE_USER = 'user';
    public const ROLE_ASSISTANT = 'assistant';
    public const ROLE_TOOL = 'tool';

    public const ROLES = [
        self::ROLE_SYSTEM,
        self::ROLE_USER,
        self::ROLE_ASSISTANT,
        self::ROLE_TOOL,
    ];

    /**
     * @param AiToolCall[] $toolCalls tool calls requested by an assistant turn
     * @param string|null $toolCallId the call this message answers (tool role only)
     * @param bool $isError whether a tool-role message carries a failure
     * @param array $reasoning provider-native reasoning blocks from this turn,
     *                         stored opaquely. Anthropic rejects a request whose
     *                         final assistant turn made a tool call but dropped
     *                         the thinking that led to it, so these have to
     *                         survive a suspension and come back untouched.
     *                         Every driver ignores blocks it does not recognise,
     *                         which is what makes them safe to carry across a
     *                         provider switch mid-conversation.
     */
    public function __construct(
        public readonly string $role,
        public readonly ?string $content = null,
        public readonly array $toolCalls = [],
        public readonly ?string $toolCallId = null,
        public readonly ?string $toolName = null,
        public readonly bool $isError = false,
        public readonly array $reasoning = [],
    ) {
    }

    public static function user(string $content): self
    {
        return new self(self::ROLE_USER, $content);
    }

    public static function assistant(?string $content, array $toolCalls = [], array $reasoning = []): self
    {
        return new self(self::ROLE_ASSISTANT, $content, $toolCalls, reasoning: $reasoning);
    }

    public static function system(string $content): self
    {
        return new self(self::ROLE_SYSTEM, $content);
    }

    /**
     * The result of a tool call, fed back to the model as the next turn's input.
     */
    public static function tool(string $toolCallId, string $toolName, string $content, bool $isError = false): self
    {
        return new self(self::ROLE_TOOL, $content, [], $toolCallId, $toolName, $isError);
    }

    public function hasToolCalls(): bool
    {
        return $this->toolCalls !== [];
    }

    public function toArray(): array
    {
        return array_filter([
            'role' => $this->role,
            'content' => $this->content,
            'tool_calls' => array_map(fn (AiToolCall $c) => $c->toArray(), $this->toolCalls) ?: null,
            'tool_call_id' => $this->toolCallId,
            'tool_name' => $this->toolName,
            'is_error' => $this->isError ?: null,
            'reasoning' => $this->reasoning ?: null,
        ], fn ($value) => $value !== null);
    }

    public static function fromArray(array $data): self
    {
        $role = (string) ($data['role'] ?? self::ROLE_USER);

        return new self(
            in_array($role, self::ROLES, true) ? $role : self::ROLE_USER,
            isset($data['content']) ? (string) $data['content'] : null,
            array_map(
                fn (array $c) => AiToolCall::fromArray($c),
                is_array($data['tool_calls'] ?? null) ? $data['tool_calls'] : []
            ),
            isset($data['tool_call_id']) ? (string) $data['tool_call_id'] : null,
            isset($data['tool_name']) ? (string) $data['tool_name'] : null,
            (bool) ($data['is_error'] ?? false),
            // Filtered to arrays on the way back in: this survives a round trip
            // through JSON in a database column, and a malformed entry would
            // otherwise reach a provider payload builder as a scalar.
            array_values(array_filter(
                is_array($data['reasoning'] ?? null) ? $data['reasoning'] : [],
                'is_array'
            )),
        );
    }
}
