<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Everest\Exceptions\DisplayException;
use Everest\Services\Billing\PlanChangeService;
use Everest\Transformers\Api\Client\ProductTransformer;
use Everest\Services\Billing\CheckoutReservationService;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Servers\GetServerRequest;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class PlanChangeController extends ClientApiController
{
    public function __construct(
        private PlanChangeService $planChangeService,
        private CheckoutReservationService $reservationService,
    ) {
        parent::__construct();
    }

    /**
     * Get all available plans in the same category as the server's current plan.
     */
    public function getAvailablePlans(GetServerRequest $request, Server $server): array
    {
        $this->assertOwner($request->user(), $server);

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
            ->where('visible', true)
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
        $this->assertOwner($request->user(), $server);
        $newProduct = Product::findOrFail($productId);

        try {
            $quote = $this->planChangeService->quote($server, $newProduct);
        } catch (DisplayException $exception) {
            return response()->json([
                'valid' => false,
                'message' => $exception->getMessage(),
            ], 400);
        }

        return response()->json([
            'valid' => (bool) $quote['valid'],
            'message' => $quote['valid']
                ? (
                    $quote['mode'] === 'pay_now'
                        ? 'Payment is required before this upgrade is applied.'
                        : 'This change can be scheduled for the current renewal date.'
                )
                : 'Current resource usage exceeds the limits of the selected plan.',
            'quote' => $quote,
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

        $validated = $request->validate([
            'billing_days' => 'nullable|integer|min:1|max:365',
        ]);
        if (
            isset($validated['billing_days'])
            && (int) $validated['billing_days'] !== (int) $server->billing_days
        ) {
            return response()->json([
                'success' => false,
                'message' => 'The billing cycle cannot be changed during a plan change.',
            ], 422);
        }

        try {
            $quote = $this->planChangeService->quote($server, $newProduct);
            if ((int) $quote['charge_minor'] > 0 && !empty($quote['violations'])) {
                return response()->json([
                    'success' => false,
                    'message' => 'Current resource usage exceeds the limits of the selected plan.',
                    'quote' => $quote,
                ], 422);
            }
            if ((int) $quote['charge_minor'] > 0) {
                return response()->json([
                    'success' => false,
                    'payment_required' => true,
                    'message' => 'Payment is required before this upgrade is applied.',
                    'quote' => $quote,
                ], 402);
            }

            $updatedServer = $this->planChangeService->scheduleChange($server, $newProduct);

            return response()->json([
                'success' => true,
                'scheduled' => true,
                'message' => 'Plan change scheduled for the current renewal date.',
                'scheduled_change' => [
                    'product_id' => (int) $updatedServer->scheduled_billing_product_id,
                    'product_name' => $newProduct->name,
                    'effective_at' => $updatedServer->scheduled_plan_change_at?->toIso8601String(),
                ],
                'quote' => $quote,
            ], 202);
        } catch (DisplayException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 400);
        }
    }

    public function scheduledChange(GetServerRequest $request, Server $server): JsonResponse
    {
        $this->assertOwner($request->user(), $server);
        $server->loadMissing([
            'scheduledProduct',
            'pendingPlanChangeOrder.product',
            'pendingPlanChangeOrder.transaction',
        ]);
        $pendingOrder = $server->pendingPlanChangeOrder;

        return response()->json([
            'scheduled_change' => $server->scheduled_billing_product_id === null
                ? null
                : [
                    'product_id' => (int) $server->scheduled_billing_product_id,
                    'product_name' => $server->scheduledProduct?->name,
                    'effective_at' => $server->scheduled_plan_change_at?->toIso8601String(),
                    'retry_at' => $server->scheduled_plan_change_retry_at?->toIso8601String(),
                    'last_error' => $server->scheduled_plan_change_last_error,
                ],
            'pending_change' => $pendingOrder === null
                ? null
                : [
                    'order_id' => (int) $pendingOrder->id,
                    'product_id' => (int) $pendingOrder->product_id,
                    'product_name' => $pendingOrder->product_name,
                    'processor' => $pendingOrder->payment_processor,
                    'created_at' => $pendingOrder->created_at->toIso8601String(),
                ],
        ]);
    }

    public function cancelPendingChange(GetServerRequest $request, Server $server): JsonResponse
    {
        $this->assertOwner($request->user(), $server);
        $server->loadMissing('pendingPlanChangeOrder');
        $order = $server->pendingPlanChangeOrder;

        if (
            $order === null
            || $order->type !== Order::TYPE_UPG
            || $order->status !== Order::STATUS_PENDING
        ) {
            return response()->json([
                'success' => false,
                'message' => 'There is no cancellable pending plan-change checkout.',
            ], 409);
        }

        $cancelled = $this->reservationService->transitionAndRelease(
            $order,
            Order::STATUS_PENDING,
            Order::STATUS_CANCELLED,
            null,
            'cancelled',
        );
        if (!$cancelled) {
            return response()->json([
                'success' => false,
                'message' => 'This plan-change checkout is already being processed or has payment evidence and requires reconciliation.',
            ], 409);
        }

        return response()->json([
            'success' => true,
            'pending_change' => null,
            'message' => 'Pending plan-change checkout cancelled.',
        ]);
    }

    public function cancelScheduledChange(GetServerRequest $request, Server $server): JsonResponse
    {
        $this->assertOwner($request->user(), $server);
        $this->planChangeService->cancelScheduledChange($server);

        return response()->json([
            'success' => true,
            'scheduled_change' => null,
            'message' => 'Scheduled plan change cancelled.',
        ]);
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
