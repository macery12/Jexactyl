<?php

namespace Everest\Services\Servers;

use Everest\Models\Server;
use Illuminate\Support\Arr;
use Illuminate\Database\ConnectionInterface;
use Everest\Traits\Services\ReturnsUpdatedModels;
use Everest\Repositories\Wings\DaemonRevocationRepository;
use Everest\Services\Billing\FreeProductEntitlementService;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;

class DetailsModificationService
{
    use ReturnsUpdatedModels;

    /**
     * DetailsModificationService constructor.
     */
    public function __construct(
        private ConnectionInterface $connection,
        private DaemonRevocationRepository $revocationRepository,
        private FreeProductEntitlementService $entitlementService,
    ) {
    }

    /**
     * Update the details for a single server instance.
     *
     * @throws \Throwable
     */
    public function handle(Server $server, array $data): Server
    {
        return $this->connection->transaction(function () use ($data, $server) {
            /** @var Server $server */
            $server = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();
            $original = $server->user;
            $newOwnerId = (int) Arr::get($data, 'owner_id');
            $newProductId = array_key_exists('billing_product_id', $data)
                ? Arr::get($data, 'billing_product_id')
                : $server->billing_product_id;
            $newProductId = $newProductId === null ? null : (int) $newProductId;

            $this->entitlementService->synchronizeLocked(
                $server,
                $newOwnerId,
                $newProductId,
            );

            $server->forceFill([
                'external_id' => Arr::get($data, 'external_id'),
                'owner_id' => $newOwnerId,
                'name' => Arr::get($data, 'name'),
                'description' => Arr::get($data, 'description') ?? '',
                'renewal_date' => array_key_exists('renewal_date', $data) ? Arr::get($data, 'renewal_date') : $server->renewal_date,
                'billing_product_id' => $newProductId,
                'billing_days' => array_key_exists('billing_days', $data) ? Arr::get($data, 'billing_days') : $server->billing_days,
            ])->saveOrFail();

            // If the owner_id value is changed we need to revoke any tokens that exist for the server
            // on the Wings instance so that the old owner no longer has any permission to access the
            // websockets.
            if (!$server->refresh()->user->is($original)) {
                try {
                    $this->revocationRepository->setNode($server->node)->deauthorize(
                        $original->uuid,
                        [$server->uuid],
                    );
                } catch (DaemonConnectionException $exception) {
                    // Do nothing. A failure here is not ideal, but it is likely to be caused by Wings
                    // being offline, or in an entirely broken state. Remember, these tokens reset every
                    // few minutes by default, we're just trying to help it along a little quicker.
                }
            }

            return $server;
        }, 5);
    }
}
