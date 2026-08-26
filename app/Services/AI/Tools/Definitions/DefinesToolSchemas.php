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

    private static function number(
        string $description,
        int|float|null $minimum = null,
        int|float|null $maximum = null,
    ): array {
        $schema = ['type' => 'number', 'description' => $description];

        if ($minimum !== null) {
            $schema['minimum'] = $minimum;
        }

        if ($maximum !== null) {
            $schema['maximum'] = $maximum;
        }

        return $schema;
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
     *
     * Two different truncations are in play and the model has to be able to tell
     * them apart. `count` is what came back in *this response*, which the shaper
     * may then have cut down to `limit`. But the response is itself one page:
     * a hundred users arrive twenty at a time, and reporting `count: 20` with no
     * pagination was read by the model — reasonably — as "this panel has twenty
     * users", which it then said out loud. So the paginator's own numbers travel
     * with the result, and the note names whichever limit actually bit.
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
        $notes = [];

        if ($total > $limit) {
            $notes[] = sprintf('Showing the first %d of %d entries on this page.', $limit, $total);
        }

        $pagination = self::paginationOf($data);

        if ($pagination !== null) {
            $result['pagination'] = $pagination;

            if ($pagination['total_pages'] > 1) {
                $notes[] = sprintf(
                    'This is page %d of %d; %d records match in total. Ask for a later page before '
                        . 'answering anything about the whole set.',
                    $pagination['page'],
                    $pagination['total_pages'],
                    $pagination['total'],
                );
            }
        }

        if ($notes !== []) {
            $result['note'] = implode(' ', $notes);
        }

        return $result;
    }

    /**
     * The paginator's own numbers, when the endpoint returned a paginated
     * collection.
     *
     * `links` is deliberately dropped: absolute URLs are unusable to a model
     * that reaches endpoints only through tool schemas, and they are the
     * largest part of the block.
     *
     * @return array{total: int, page: int, per_page: int, total_pages: int}|null
     */
    private static function paginationOf(mixed $data): ?array
    {
        $meta = is_array($data['meta']['pagination'] ?? null) ? $data['meta']['pagination'] : null;

        if ($meta === null || !isset($meta['total'], $meta['current_page'], $meta['total_pages'])) {
            return null;
        }

        return [
            'total' => (int) $meta['total'],
            'page' => (int) $meta['current_page'],
            'per_page' => (int) ($meta['per_page'] ?? count($data['data'] ?? [])),
            'total_pages' => (int) $meta['total_pages'],
        ];
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
