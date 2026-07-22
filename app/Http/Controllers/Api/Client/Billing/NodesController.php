<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Illuminate\Http\Request;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\BillingException;
use Everest\Transformers\Api\Client\NodeTransformer;
use Everest\Services\Billing\NodeAvailabilityService;
use Everest\Http\Controllers\Api\Client\ClientApiController;

class NodesController extends ClientApiController
{
    public function __construct(private NodeAvailabilityService $nodeAvailabilityService)
    {
        parent::__construct();
    }

    /**
     * Returns all the nodes that the server can be deployed to.
     */
    public function index(Request $request, Product $product): array
    {
        $free = (float) $product->price === 0.00;
        $availableNodes = $this->nodeAvailabilityService->getAvailableNodesForProduct($product);

        if ($availableNodes->isEmpty() && !$free) {
            BillingException::create([
                'title' => 'No deployable nodes found',
                'exception_type' => BillingException::TYPE_DEPLOYMENT,
                'description' => 'Ensure at least one node has the "deployable" box checked',
            ]);
        }

        if ($availableNodes->isEmpty()) {
            BillingException::create([
                'title' => 'No nodes satisfy requirements',
                'exception_type' => BillingException::TYPE_DEPLOYMENT,
                'description' => 'Available nodes are either offline or have zero free allocations',
            ]);
        }

        return $this->fractal->collection($availableNodes)
            ->transformWith(NodeTransformer::class)
            ->toArray();
    }
}
