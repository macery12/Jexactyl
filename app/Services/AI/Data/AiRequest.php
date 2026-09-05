<?php

namespace Everest\Services\AI\Data;

/**
 * One inference call. Immutable — the agent loop derives a new request per step
 * with `withMessages()` rather than mutating shared state, so a retry or repair
 * attempt can never leak arguments into the next step.
 */
class AiRequest
{
    public const TOOL_CHOICE_AUTO = 'auto';
    public const TOOL_CHOICE_REQUIRED = 'required';
    public const TOOL_CHOICE_NONE = 'none';

    /**
     * @param AiMessage[] $messages
     * @param AiTool[] $tools
     * @param array|null $responseSchema JSON Schema forcing structured output. Used by the
     *                                   repair path to make a local model emit a valid tool
     *                                   call after it has produced a malformed one.
     * @param bool $reasoning ask the model to think before answering, where it can. Set by
     *                        the agent loop and not by plain chat: reasoning is worth its
     *                        latency when choosing between fifteen tools, and not worth it
     *                        when answering a question about port forwarding. Drivers whose
     *                        model cannot reason ignore it.
     */
    public function __construct(
        public readonly array $messages,
        public readonly ?string $systemPrompt = null,
        public readonly array $tools = [],
        public readonly string $toolChoice = self::TOOL_CHOICE_AUTO,
        public readonly ?string $model = null,
        public readonly ?int $maxTokens = null,
        public readonly ?float $temperature = null,
        public readonly ?array $responseSchema = null,
        public readonly bool $noCache = false,
        public readonly bool $reasoning = false,
    ) {
    }

    public function hasTools(): bool
    {
        return $this->tools !== [];
    }

    /**
     * @param AiMessage[] $messages
     */
    public function withMessages(array $messages): self
    {
        return new self(
            $messages,
            $this->systemPrompt,
            $this->tools,
            $this->toolChoice,
            $this->model,
            $this->maxTokens,
            $this->temperature,
            $this->responseSchema,
            $this->noCache,
            $this->reasoning,
        );
    }

    /**
     * @param AiTool[] $tools
     */
    public function withTools(array $tools, ?string $toolChoice = null): self
    {
        return new self(
            $this->messages,
            $this->systemPrompt,
            $tools,
            $toolChoice ?? $this->toolChoice,
            $this->model,
            $this->maxTokens,
            $this->temperature,
            $this->responseSchema,
            $this->noCache,
            $this->reasoning,
        );
    }

    /**
     * Force schema-valid output for a single repair attempt. Caching is disabled
     * on the result because a repair is by definition a retry of something that
     * already failed — serving it from cache would replay the failure.
     */
    public function withResponseSchema(array $schema): self
    {
        return new self(
            $this->messages,
            $this->systemPrompt,
            $this->tools,
            $this->toolChoice,
            $this->model,
            $this->maxTokens,
            $this->temperature,
            $schema,
            true,
            $this->reasoning,
        );
    }

    /**
     * Ask for reasoning on this request.
     */
    public function withReasoning(bool $reasoning = true): self
    {
        return new self(
            $this->messages,
            $this->systemPrompt,
            $this->tools,
            $this->toolChoice,
            $this->model,
            $this->maxTokens,
            $this->temperature,
            $this->responseSchema,
            $this->noCache,
            $reasoning,
        );
    }

    public function withOverrides(?string $model = null, ?int $maxTokens = null, ?float $temperature = null): self
    {
        return new self(
            $this->messages,
            $this->systemPrompt,
            $this->tools,
            $this->toolChoice,
            $model ?? $this->model,
            $maxTokens ?? $this->maxTokens,
            $temperature ?? $this->temperature,
            $this->responseSchema,
            $this->noCache,
            $this->reasoning,
        );
    }
}
