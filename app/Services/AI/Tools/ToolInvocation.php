<?php

namespace Everest\Services\AI\Tools;

/**
 * A resolved, ready-to-dispatch call.
 *
 * Produced by the registry from a tool definition plus the model's arguments.
 * By the time an invocation exists, the URI is fully interpolated — crucially
 * including the server identifier, which comes from the turn's bound context
 * and never from model output. A hallucinated server id has nowhere to land
 * because server-scoped tool schemas do not accept one.
 */
class ToolInvocation
{
    public function __construct(
        public readonly string $tool,
        public readonly string $method,
        public readonly string $uri,
        public readonly array $query = [],
        public readonly array $body = [],
        public readonly ?string $idempotencyKey = null,
    ) {
    }

    public function withIdempotencyKey(?string $key): self
    {
        return new self($this->tool, $this->method, $this->uri, $this->query, $this->body, $key);
    }

    public function isRead(): bool
    {
        return in_array(strtoupper($this->method), ['GET', 'HEAD'], true);
    }

    /**
     * The path plus query string, as it will be dispatched.
     */
    public function fullUri(): string
    {
        if ($this->query === []) {
            return $this->uri;
        }

        return $this->uri . '?' . http_build_query($this->query);
    }
}
