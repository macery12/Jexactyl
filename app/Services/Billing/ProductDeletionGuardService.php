<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;

class ProductDeletionGuardService
{
    /**
     * Prevent catalog deletion from orphaning an active server, a scheduled
     * change, or a paid upgrade that may need capture recovery.
     *
     * @param iterable<int|string> $productIds
     */
    public function assertDeletable(iterable $productIds): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Billing product deletion checks must run inside the deletion transaction.');
        }

        $ids = [];
        foreach ($productIds as $productId) {
            $ids[] = (int) $productId;
        }
        $ids = array_values(array_unique(array_filter($ids, static fn (int $id): bool => $id > 0)));
        if ($ids === []) {
            return;
        }

        $referencedServer = Server::query()
            ->where(function ($query) use ($ids): void {
                $query->whereIn('billing_product_id', $ids)
                    ->orWhereIn('scheduled_billing_product_id', $ids);
            })
            ->orderBy('id')
            ->lockForUpdate()
            ->first();
        if ($referencedServer !== null) {
            throw new DisplayException('This billing product cannot be deleted while an active server or scheduled plan change references it.');
        }

        $activeUpgrade = Order::query()
            ->whereIn('product_id', $ids)
            ->where('type', Order::TYPE_UPG)
            ->whereIn('status', [
                Order::STATUS_PENDING,
                Order::STATUS_FULFILLING,
                Order::STATUS_PAYMENT_REVIEW,
            ])
            ->orderBy('id')
            ->lockForUpdate()
            ->first();
        if ($activeUpgrade !== null) {
            throw new DisplayException('This billing product cannot be deleted while a plan-change payment is pending or requires reconciliation.');
        }
    }
}
