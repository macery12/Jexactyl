<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Everest\Exceptions\DisplayException;
use Everest\Services\Billing\PlanChangeService;
use Everest\Transformers\Api\Client\ProductTransformer;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Servers\GetServerRequest;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class PlanChangeController extends ClientApiController
{
    public function __construct(
        private PlanChangeService $planChangeService,
    ) {
        parent::__construct();
    }

    /**
     * Get all available plans in the same category as the server's current plan.
     */
    public function getAvailablePlans(GetServerRequest $request, Server $server): array
    {
        if (!$server->billing_product_id) {
            throw new DisplayException('This server is not associated with a billing product.');
        }

        $currentProduct = Product::findOrFail($server->billing_product_id);

        // Get the category to check if plan changes are allowed
        $category = Category::where('uuid', $currentProduct->category_uuid)->first();

        // If category doesn't exist or plan changes are not allowed, return empty list
        if (!$category || !$category->allow_plan_changes) {
            return $this->fractal->collection(collect([]))
                ->transformWith(ProductTransformer::class)
                ->toArray();
        }

        // Get all products in the same category
        $products = Product::where('category_uuid', $currentProduct->category_uuid)
            ->where('id', '!=', $currentProduct->id)
            ->get();

        return $this->fractal->collection($products)
            ->transformWith(ProductTransformer::class)
            ->toArray();
    }

    /**
     * Validate if a plan change is possible.
     * Returns validation results including any resource violations.
     */
    public function validatePlanChange(GetServerRequest $request, Server $server, int $productId): JsonResponse
    {
        $newProduct = Product::findOrFail($productId);

        if (!$server->billing_product_id) {
            return response()->json([
                'valid' => false,
                'message' => 'This server is not associated with a billing product.',
            ], 400);
        }

        $currentProduct = Product::find($server->billing_product_id);

        // Ensure products are in the same category
        if ($currentProduct && $currentProduct->category_uuid !== $newProduct->category_uuid) {
            return response()->json([
                'valid' => false,
                'message' => 'Cannot change to a plan in a different category.',
            ], 400);
        }

        // Check for resource violations
        $violations = $this->planChangeService->validatePlanDowngrade($server, $newProduct);

        if (!empty($violations)) {
            return response()->json([
                'valid' => false,
                'violations' => $violations,
                'message' => 'Current resource usage exceeds the limits of the selected plan.',
            ]);
        }

        return response()->json([
            'valid' => true,
            'message' => 'Plan change is allowed.',
        ]);
    }

    /**
     * Apply a plan change to the server.
     *
     * Restricted to the server owner (and root admins): a plan change rewrites the billing
     * product and cycle that the owner is charged on at renewal, so it is not delegable to
     * subusers.
     */
    public function changePlan(GetServerRequest $request, Server $server, int $productId): JsonResponse
    {
        $this->assertOwner($request->user(), $server);

        $newProduct = Product::findOrFail($productId);

        // Re-verify that the server has a billing product
        if (!$server->billing_product_id) {
            return response()->json([
                'success' => false,
                'message' => 'This server is not associated with a billing product.',
            ], 400);
        }

        // Re-verify products are in the same category (cannot be bypassed by skipping validatePlanChange)
        $currentProduct = Product::find($server->billing_product_id);
        if ($currentProduct && $currentProduct->category_uuid !== $newProduct->category_uuid) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot change to a plan in a different category.',
            ], 400);
        }

        // Re-verify that plan changes are allowed for this category (guard against bypassing validatePlanChange)
        $category = Category::where('uuid', $newProduct->category_uuid)->first();
        if (!$category || !$category->allow_plan_changes) {
            return response()->json([
                'success' => false,
                'message' => 'Plan changes are not allowed for this category.',
            ], 403);
        }

        // Validate and get billing_days from request
        $validated = $request->validate([
            'billing_days' => 'nullable|integer|min:1|max:365',
        ]);

        $billingDays = $validated['billing_days'] ?? null;

        try {
            $updatedServer = $this->planChangeService->changePlan($server, $newProduct, false, $billingDays);

            return response()->json([
                'success' => true,
                'message' => 'Plan changed successfully.',
                'server' => [
                    'id' => $updatedServer->id,
                    'uuid' => $updatedServer->uuid,
                    'billing_product_id' => $updatedServer->billing_product_id,
                    'billing_days' => $updatedServer->billing_days,
                    'limits' => [
                        'memory' => $updatedServer->memory,
                        'disk' => $updatedServer->disk,
                        'cpu' => $updatedServer->cpu,
                        'database' => $updatedServer->database_limit,
                        'backup' => $updatedServer->backup_limit,
                        'allocation' => $updatedServer->allocation_limit,
                        'subdomain' => $updatedServer->subdomain_limit ?? $updatedServer->product?->subdomain_limit,
                    ],
                ],
            ]);
        } catch (DisplayException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 400);
        }
    }

    /**
     * Root admins may change the plan on any server; everyone else must be the owner.
     * Subusers are deliberately excluded even with full server permissions, since the
     * charge lands on the owner rather than on the caller.
     */
    private function assertOwner(User $user, Server $server): void
    {
        if ($user->id !== $server->owner_id && !$user->root_admin) {
            throw new AccessDeniedHttpException('Only the server owner can change the billing plan.');
        }
    }
}
