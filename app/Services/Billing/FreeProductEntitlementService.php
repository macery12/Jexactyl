<?php

namespace Everest\Services\Billing;

use Everest\Models\Server;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Product;
use Everest\Exceptions\DisplayException;
use Everest\Models\Billing\FreeProductEntitlement;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Keeps the one-server-per-user free-product guard synchronized with server
 * ownership and billing-product changes.
 *
 * Callers must invoke synchronizeLocked() in the same transaction that locks
 * and updates the server. This prevents an owner/product mutation from becoming
 * visible without its matching entitlement mutation.
 */
class FreeProductEntitlementService
{
    public function synchronizeLocked(Server $server, int $newOwnerId, ?int $newProductId): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Free-product entitlements must be synchronized inside a database transaction.');
        }

        $productIds = array_values(array_unique(array_filter([
            $server->billing_product_id,
            $newProductId,
        ], static fn ($id): bool => $id !== null)));
        sort($productIds);

        /** @var \Illuminate\Support\Collection<int, Product> $products */
        $products = Product::query()
            ->whereIn('id', $productIds)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');

        /** @var Product|null $newProduct */
        $newProduct = $newProductId === null ? null : $products->get($newProductId);
        if ($newProductId !== null && $newProduct === null) {
            throw new DisplayException('The selected billing product no longer exists.');
        }

        $entitlements = FreeProductEntitlement::query()
            ->where(function ($query) use ($server, $newOwnerId, $newProductId): void {
                $query->where('server_id', $server->id);
                if ($newProductId !== null) {
                    $query->orWhere(function ($target) use ($newOwnerId, $newProductId): void {
                        $target
                            ->where('user_id', $newOwnerId)
                            ->where('product_id', $newProductId);
                    });
                }
            })
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        /** @var FreeProductEntitlement|null $linked */
        $linked = $entitlements->first(
            static fn (FreeProductEntitlement $entitlement): bool => $entitlement->server_id === $server->id
        );

        if ($newProduct === null || !$newProduct->isFree()) {
            $linked?->delete();

            return;
        }

        /** @var FreeProductEntitlement|null $target */
        $target = $entitlements->first(
            static fn (FreeProductEntitlement $entitlement): bool => $entitlement->user_id === $newOwnerId
                && $entitlement->product_id === $newProduct->id
        );

        // A reserved checkout and an entitlement consumed by another server
        // both own this unique user/product slot. An administrative transition
        // must never steal either one.
        if ($target !== null && $target->server_id !== $server->id) {
            throw new DisplayException('The new owner already has a server or pending checkout for this free product.');
        }

        if ($linked !== null && $linked->id !== $target?->id) {
            $linked->delete();
        }

        if ($target !== null) {
            $target->forceFill([
                'status' => 'consumed',
                'server_id' => $server->id,
                'expires_at' => null,
            ])->saveOrFail();

            return;
        }

        try {
            FreeProductEntitlement::query()->create([
                'user_id' => $newOwnerId,
                'product_id' => $newProduct->id,
                'server_id' => $server->id,
                'status' => 'consumed',
                'expires_at' => null,
            ]);
        } catch (UniqueConstraintViolationException) {
            throw new DisplayException('The new owner already has a server or pending checkout for this free product.');
        }
    }
}
