<?php

namespace Everest\Services\AI\Tools\Definitions;

/**
 * Shared helpers for writing tool argument schemas and shaping responses.
 *
 * Every panel response is sized for a UI rather than a context window — a user
 * listing is a full Fractal collection with relations — so `mapList()` is the
 * difference between a tool the model can use and one that consumes the whole
 * window on its first call.
 */
trait DefinesToolSchemas
{
    private static function object(array $properties, array $required = []): array
    {
        return [
            'type' => 'object',
            // An empty PHP array encodes as a JSON array, which providers
            // reject where an object is required.
            'properties' => $properties ?: new \stdClass(),
            'required' => $required,
        ];
    }

    private static function string(string $description): array
    {
        return ['type' => 'string', 'description' => $description];
    }

    private static function integer(string $description): array
    {
        return ['type' => 'integer', 'description' => $description];
    }

    private static function number(string $description): array
    {
        return ['type' => 'number', 'description' => $description];
    }

    private static function boolean(string $description): array
    {
        return ['type' => 'boolean', 'description' => $description];
    }

    private static function enum(array $values, string $description): array
    {
        return ['type' => 'string', 'enum' => $values, 'description' => $description];
    }

    /**
     * Map a Fractal collection down to the fields the model needs, capped.
     */
    private static function mapList(mixed $data, callable $map, int $limit): array
    {
        $rows = is_array($data['data'] ?? null) ? $data['data'] : [];
        $total = count($rows);
        $items = [];

        foreach (array_slice($rows, 0, $limit) as $row) {
            $attributes = is_array($row['attributes'] ?? null) ? $row['attributes'] : (is_array($row) ? $row : []);
            $items[] = $map($attributes);
        }

        $result = ['items' => $items, 'count' => $total];

        if ($total > $limit) {
            $result['note'] = sprintf('Showing the first %d of %d entries.', $limit, $total);
        }

        return $result;
    }

    /**
     * Map a single Fractal item down to the fields the model needs.
     */
    private static function mapItem(mixed $data, callable $map): array
    {
        $attributes = is_array($data['attributes'] ?? null)
            ? $data['attributes']
            : (is_array($data) ? $data : []);

        return $map($attributes);
    }
}
