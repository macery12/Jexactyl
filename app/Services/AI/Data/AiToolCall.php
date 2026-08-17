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
    /**
     * The identity namespace the panel mints batch children into.
     *
     * Reserved rather than merely unlikely. Batch children need ids the panel
     * derives, and provider ids are unconstrained strings — so the two would
     * otherwise share one space and a collision would merge two distinct calls
     * into one visible row, attaching a result to the wrong one. Providers do
     * not get to write here: `ensureCallId()` remints anything matching this,
     * which is what makes "derived" and "provider-supplied" disjoint by
     * construction rather than by improbability.
     */
    private const DERIVED_PATTERN = '/^batch_[0-9a-f]{32}_\d+$/';

    /** A batch child's id: a turn-bound digest and its position. */
    public static function derivedBatchId(string $digest, int $index): string
    {
        return sprintf('batch_%s_%d', $digest, $index);
    }

    /** Whether an id belongs to the reserved derived namespace. */
    public static function isDerivedId(string $id): bool
    {
        return preg_match(self::DERIVED_PATTERN, $id) === 1;
    }

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
