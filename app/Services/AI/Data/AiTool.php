<?php

namespace Everest\Services\AI\Data;

/**
 * The wire representation of a tool as presented to the model.
 *
 * Deliberately separate from the registry's ToolDefinition: that class carries
 * panel-side concerns (route, risk tier, required permission) which must never
 * be serialised into a prompt. This is only what the model is allowed to see.
 */
class AiTool
{
    /**
     * @param array $parameters JSON Schema object describing the arguments
     */
    public function __construct(
        public readonly string $name,
        public readonly string $description,
        public readonly array $parameters,
    ) {
    }

    /**
     * An empty JSON Schema object. Providers reject `[]` here because PHP
     * encodes an empty array as a JSON array rather than an object, so tools
     * taking no arguments must use this shape.
     */
    public static function emptySchema(): array
    {
        return [
            'type' => 'object',
            'properties' => new \stdClass(),
            'required' => [],
        ];
    }

    /**
     * OpenAI / Ollama chat-completions shape.
     */
    public function toOpenAiFormat(): array
    {
        return [
            'type' => 'function',
            'function' => [
                'name' => $this->name,
                'description' => $this->description,
                'parameters' => $this->parameters,
            ],
        ];
    }

    /**
     * Anthropic Messages API shape.
     */
    public function toAnthropicFormat(): array
    {
        return [
            'name' => $this->name,
            'description' => $this->description,
            'input_schema' => $this->parameters,
        ];
    }
}
