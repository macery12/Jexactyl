<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Everest\Models\Billing\Order;
use Illuminate\Http\JsonResponse;
use Spatie\QueryBuilder\QueryBuilder;
use Spatie\QueryBuilder\AllowedFilter;
use Illuminate\Database\Eloquent\Builder;
use Everest\Services\Billing\ThreatIndexService;
use Everest\Transformers\Api\Application\OrderTransformer;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Billing\Orders\GetBillingOrdersRequest;

class OrderController extends ApplicationApiController
{
    public function __construct(private readonly ThreatIndexService $threatIndexService)
    {
        parent::__construct();
    }

    /**
     * Get all orders.
     */
    public function index(GetBillingOrdersRequest $request): array
    {
        $perPage = (int) $request->query('per_page', '20');
        if ($perPage < 1 || $perPage > 100) {
            throw new QueryValueOutOfRangeHttpException('per_page', 1, 100);
        }

        $orders = QueryBuilder::for(Order::query()->with('server', 'transaction', 'product', 'user'))
            ->allowedFilters(...[
                'id', 'name', 'description', 'payment_processor', 'status', 'type',
                AllowedFilter::callback('search', function (Builder $query, $value) {
                    $query->where(function ($q) use ($value) {
                        $q->where('id', 'LIKE', "%{$value}%")
                          ->orWhere('name', 'LIKE', "%{$value}%")
                          ->orWhere('description', 'LIKE', "%{$value}%")
                          ->orWhere('user_id', 'LIKE', "%{$value}%")
                          ->orWhereHas('server', function ($q) use ($value) {
                              $q->where('name', 'LIKE', "%{$value}%");
                          })
                          ->orWhereHas('user', function ($q) use ($value) {
                              $q->where('username', 'LIKE', "%{$value}%")
                                ->orWhere('email', 'LIKE', "%{$value}%");
                          })
                          ->orWhereHas('transaction', function ($q) use ($value) {
                              $q->where('external_id', 'LIKE', "%{$value}%")
                                ->orWhere('capture_id', 'LIKE', "%{$value}%")
                                ->orWhere('payer_id', 'LIKE', "%{$value}%")
                                ->orWhere('payer_email', 'LIKE', "%{$value}%");
                          });
                    });
                }),
                AllowedFilter::callback('transaction_id', function (Builder $query, $value) {
                    $query->whereHas('transaction', function ($q) use ($value) {
                        $q->where('external_id', 'LIKE', "%{$value}%");
                    });
                }),
                AllowedFilter::callback('capture_id', function (Builder $query, $value) {
                    $query->whereHas('transaction', function ($q) use ($value) {
                        $q->where('capture_id', 'LIKE', "%{$value}%");
                    });
                }),
                AllowedFilter::callback('payer_id', function (Builder $query, $value) {
                    $query->whereHas('transaction', function ($q) use ($value) {
                        $q->where('payer_id', 'LIKE', "%{$value}%");
                    });
                }),
                AllowedFilter::callback('payer_email', function (Builder $query, $value) {
                    $query->whereHas('transaction', function ($q) use ($value) {
                        $q->where('payer_email', 'LIKE', "%{$value}%");
                    });
                }),
                AllowedFilter::callback('min_amount', function (Builder $query, $value) {
                    $query->where('total', '>=', $value);
                }),
                AllowedFilter::callback('max_amount', function (Builder $query, $value) {
                    $query->where('total', '<=', $value);
                }),
                AllowedFilter::callback('start_date', function (Builder $query, $value) {
                    $query->where('created_at', '>=', $value);
                }),
                AllowedFilter::callback('end_date', function (Builder $query, $value) {
                    $query->where('created_at', '<=', $value);
                }),
            ])
            ->allowedSorts(...['id', 'name', 'total', 'is_renewal', 'created_at', 'threat_index'])
            ->defaultSort('-created_at')
            ->paginate($perPage);

        return $this->fractal->collection($orders)
            ->transformWith(OrderTransformer::class)
            ->toArray();
    }

    /**
     * Return the threat score breakdown for a single order.
     */
    public function threat(GetBillingOrdersRequest $request, Order $order): JsonResponse
    {
        return new JsonResponse($this->threatIndexService->breakdown($order));
    }
}
