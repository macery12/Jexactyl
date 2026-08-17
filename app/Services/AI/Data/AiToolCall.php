<?php

namespace Everest\Services\AI\Data;

/**
 * A single tool invocation requested by the model.
 *
 * The `arguments` array is whatever the model produced — it has NOT been
 * validated against the tool's JSON schema at this point. Validation happens
 * in the agent loop so that a schema failure can be fed back to the model as a
 * repairable error rather than blowing up the turn.
 */
class AiToolCall
{
    public function __construct(
        public readonly string $id,
        public readonly string $name,
        public readonly array $arguments = [],
        public readonly ?string $batchParentId = null,
        public readonly ?int $batchIndex = null,
    ) {
    }

    /**
     * Build from a decoded provider payload where arguments arrive as a JSON string.
     *
     * Models routinely emit `""`, `"{}"`, or truncated JSON for zero-argument
     * calls; all of those decode to an empty argument set rather than an error,
     * because "the model called a no-arg tool" is the overwhelmingly likely
     * intent and the schema validator will catch it if it is not.
     */
    public static function fromJsonArguments(string $id, string $name, ?string $arguments): self
    {
        $decoded = json_decode($arguments ?? '', true);

        return new self($id, $name, is_array($decoded) ? $decoded : []);
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'arguments' => $this->arguments,
            'batch_parent_id' => $this->batchParentId,
            'batch_index' => $this->batchIndex,
        ];
    }

    public static function fromArray(array $data): self
    {
        return new self(
            (string) ($data['id'] ?? ''),
            (string) ($data['name'] ?? ''),
            is_array($data['arguments'] ?? null) ? $data['arguments'] : [],
            is_string($data['batch_parent_id'] ?? null) ? $data['batch_parent_id'] : null,
            isset($data['batch_index']) && is_numeric($data['batch_index']) ? (int) $data['batch_index'] : null,
        );
    }
}
