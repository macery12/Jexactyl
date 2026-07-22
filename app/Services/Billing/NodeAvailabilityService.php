<?php

namespace Everest\Services\Billing;

use Everest\Models\Node;
use Illuminate\Support\Collection;
use Everest\Models\Billing\Product;
use Illuminate\Support\Facades\Cache;
use Everest\Repositories\Wings\DaemonConfigurationRepository;

class NodeAvailabilityService
{
    public function __construct(private DaemonConfigurationRepository $repository)
    {
    }

    /**
     * Get all deployable and currently available nodes for a product.
     */
    public function getAvailableNodesForProduct(Product $product): Collection
    {
        $isFreeProduct = (float) $product->price === 0.00;

        $nodes = Node::where($isFreeProduct ? 'deployable_free' : 'deployable', true)->get();

        return $nodes->filter(function (Node $node) {
            return $this->isNodeAvailable($node);
        });
    }

    /**
     * Check whether a node is available, using a 30-second cache to avoid
     * synchronous Wings HTTP calls on every checkout page load.
     */
    private function isNodeAvailable(Node $node): bool
    {
        $cacheKey = "billing.node_available.{$node->id}";

        return Cache::remember($cacheKey, 30, function () use ($node) {
            if (!$node->allocations()->whereNull('server_id')->exists()) {
                return false;
            }
            try {
                $this->repository->setNode($node)->getSystemInformation();

                return true;
            } catch (\Throwable) {
                return false;
            }
        });
    }

    /**
     * Determine whether at least one deployable node is currently available for a product.
     */
    public function hasAvailableNodesForProduct(Product $product): bool
    {
        return $this->getAvailableNodesForProduct($product)->isNotEmpty();
    }
}
