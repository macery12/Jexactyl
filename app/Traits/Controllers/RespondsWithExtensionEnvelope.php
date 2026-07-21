<?php

namespace Everest\Traits\Controllers;

use Illuminate\Http\JsonResponse;

/**
 * The response-envelope contract for extension-contributed API endpoints,
 * matching the shape the core application API uses. Extension controllers
 * should build every success response through these helpers; errors flow
 * through the panel's exception handler (throw DisplayException) instead of
 * hand-rolled error JSON. See docs/extensions/architecture.md.
 */
trait RespondsWithExtensionEnvelope
{
    /**
     * A collection response: { object: "list", data: [...], meta?: {...} }.
     *
     * @param array $items zero-indexed list of items (arrays or Arrayables)
     * @param array $meta optional metadata about the collection (filters,
     *                    ranges, totals) — omitted from the payload when empty
     */
    protected function extensionListResponse(array $items, array $meta = []): JsonResponse
    {
        $payload = [
            'object' => 'list',
            'data' => array_values($items),
        ];

        if ($meta !== []) {
            $payload['meta'] = $meta;
        }

        return new JsonResponse($payload);
    }

    /**
     * A single-resource response: { object: "<type>", attributes: {...} }.
     *
     * @param string $object the resource type name, e.g. "node_health_snapshot"
     */
    protected function extensionItemResponse(string $object, array $attributes, int $status = 200): JsonResponse
    {
        return new JsonResponse([
            'object' => $object,
            'attributes' => $attributes,
        ], $status);
    }
}
