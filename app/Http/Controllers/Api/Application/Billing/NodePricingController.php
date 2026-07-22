<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Everest\Models\Node;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\GetNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\ResetNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\UpdateNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\ResetAllNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\BatchUpdateNodePricingRequest;

class NodePricingController extends ApplicationApiController
{
    /**
     * Get all nodes with their pricing multipliers.
     */
    public function index(GetNodePricingRequest $request): JsonResponse
    {
        $nodes = Node::select('id', 'name', 'price_multiplier', 'price_multiplier_description', 'deployable', 'deployable_free')
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $nodes->map(function ($node) {
                return [
                    'id' => $node->id,
                    'name' => $node->name,
                    'price_multiplier' => $node->price_multiplier ?? 1.0,
                    'price_multiplier_description' => $node->price_multiplier_description,
                    'deployable' => $node->deployable,
                    'deployable_free' => $node->deployable_free,
                ];
            }),
        ]);
    }

    /**
     * Update a node's pricing multiplier.
     */
    public function update(UpdateNodePricingRequest $request, int $id): JsonResponse
    {
        $node = Node::findOrFail($id);
        $data = $request->validated();

        $multiplier = (float) $data['price_multiplier'];
        $description = $this->normalizeDescription($data['price_multiplier_description'] ?? null);

        $oldMultiplier = $node->price_multiplier;
        $node->price_multiplier = $multiplier;
        $node->price_multiplier_description = $description;
        $node->save();

        Activity::event('admin:billing:node-pricing:update')
            ->property('node_id', $node->id)
            ->property('node_name', $node->name)
            ->property('old_multiplier', $oldMultiplier)
            ->property('new_multiplier', $multiplier)
            ->description("Updated pricing multiplier for node '{$node->name}' from {$oldMultiplier}x to {$multiplier}x")
            ->log();

        return response()->json([
            'data' => [
                'id' => $node->id,
                'name' => $node->name,
                'price_multiplier' => $node->price_multiplier,
                'price_multiplier_description' => $node->price_multiplier_description,
            ],
        ]);
    }

    /**
     * Update multiple node pricing multipliers at once.
     */
    public function batchUpdate(BatchUpdateNodePricingRequest $request): JsonResponse
    {
        $updates = $request->validated()['nodes'];
        $updatedNodes = [];

        foreach ($updates as $update) {
            $node = Node::find($update['id']);
            if (!$node) {
                continue;
            }

            $multiplier = (float) $update['price_multiplier'];
            $description = array_key_exists('price_multiplier_description', $update)
                ? $this->normalizeDescription($update['price_multiplier_description'])
                : $node->price_multiplier_description;

            $oldMultiplier = $node->price_multiplier;
            $oldDescription = $node->price_multiplier_description;
            $node->price_multiplier = $multiplier;
            $node->price_multiplier_description = $description;
            $node->save();

            $updatedNodes[] = [
                'id' => $node->id,
                'name' => $node->name,
                'old_multiplier' => $oldMultiplier,
                'new_multiplier' => $multiplier,
                'old_description' => $oldDescription,
                'new_description' => $description,
            ];
        }

        Activity::event('admin:billing:node-pricing:batch-update')
            ->property('updates', $updatedNodes)
            ->description('Batch updated pricing multipliers for ' . count($updatedNodes) . ' node(s)')
            ->log();

        return response()->json([
            'data' => $updatedNodes,
        ]);
    }

    /**
     * Reset a node's pricing multiplier to default (1.00).
     */
    public function reset(ResetNodePricingRequest $request, int $id): JsonResponse
    {
        $node = Node::findOrFail($id);
        $oldMultiplier = $node->price_multiplier;
        $node->price_multiplier = 1.0;
        $node->save();

        Activity::event('admin:billing:node-pricing:reset')
            ->property('node_id', $node->id)
            ->property('node_name', $node->name)
            ->property('old_multiplier', $oldMultiplier)
            ->description("Reset pricing multiplier for node '{$node->name}' to 1.00x")
            ->log();

        return response()->json([
            'data' => [
                'id' => $node->id,
                'name' => $node->name,
                'price_multiplier' => $node->price_multiplier,
                'price_multiplier_description' => $node->price_multiplier_description,
            ],
        ]);
    }

    /**
     * Reset all nodes' pricing multipliers to default (1.00).
     */
    public function resetAll(ResetAllNodePricingRequest $request): JsonResponse
    {
        $nodes = Node::all();
        $resetCount = 0;

        foreach ($nodes as $node) {
            if ($node->price_multiplier != 1.0) {
                $node->price_multiplier = 1.0;
                $node->save();
                ++$resetCount;
            }
        }

        Activity::event('admin:billing:node-pricing:reset-all')
            ->property('reset_count', $resetCount)
            ->description("Reset pricing multipliers for {$resetCount} node(s) to 1.00x")
            ->log();

        return response()->json([
            'data' => [
                'reset_count' => $resetCount,
            ],
        ]);
    }

    /**
     * Normalize and validate the provided price multiplier description.
     */
    protected function normalizeDescription(mixed $description): ?string
    {
        if ($description === null) {
            return null;
        }

        $trimmed = trim($description);

        if ($trimmed === '') {
            return null;
        }

        return $trimmed;
    }
}
