<?php

namespace Everest\Services\Servers;

use Everest\Models\Server;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\ConnectionInterface;
use Everest\Repositories\Wings\DaemonServerRepository;
use Everest\Services\Databases\DatabaseManagementService;
use Everest\Jobs\CustomDomains\CleanupServerCustomDomainsJob;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;

class ServerDeletionService
{
    protected bool $force = false;

    /**
     * ServerDeletionService constructor.
     */
    public function __construct(
        private ConnectionInterface $connection,
        private DaemonServerRepository $daemonServerRepository,
        private DatabaseManagementService $databaseManagementService,
    ) {
    }

    /**
     * Set if the server should be forcibly deleted from the panel (ignoring daemon errors) or not.
     */
    public function withForce(bool $bool = true): self
    {
        $this->force = $bool;

        return $this;
    }

    /**
     * Delete a server from the panel, clear any allocation notes, and remove any associated databases from hosts.
     *
     * @throws \Throwable
     * @throws \Everest\Exceptions\DisplayException
     */
    public function handle(Server $server): void
    {
        try {
            $this->daemonServerRepository->setServer($server)->delete();
        } catch (DaemonConnectionException $exception) {
            // If there is an error not caused a 404 error and this isn't a forced delete,
            // go ahead and bail out. We specifically ignore a 404 since that can be assumed
            // to be a safe error, meaning the server doesn't exist at all on Wings so there
            // is no reason we need to bail out from that.
            if (!$this->force && $exception->getStatusCode() !== Response::HTTP_NOT_FOUND) {
                throw $exception;
            }

            Log::warning($exception);
        }

        // Clean up custom domain DNS records BEFORE deleting the server.
        // The server_custom_domains table has a cascadeOnDelete FK on server_id, which means
        // the DB cascade removes the rows at the same time the server row is deleted. By the
        // time the async CleanupServerCustomDomainsJob (dispatched in ServerObserver::deleted)
        // runs, the rows are already gone and Cloudflare DNS records are never removed.
        // Running the job synchronously here — outside the transaction and before the server
        // row is deleted — ensures the rows still exist when cleanup runs.
        if (config('modules.custom_domains.cleanup_on_delete', true)) {
            CleanupServerCustomDomainsJob::dispatchSync($server->id);
        }

        $this->connection->transaction(function () use ($server) {
            foreach ($server->databases as $database) {
                try {
                    $this->databaseManagementService->delete($database);
                } catch (\Exception $exception) {
                    if (!$this->force) {
                        throw $exception;
                    }

                    // Oh well, just try to delete the database entry we have from the database
                    // so that the server itself can be deleted. This will leave it dangling on
                    // the host instance, but we couldn't delete it anyways so not sure how we would
                    // handle this better anyways.
                    //
                    // @see https://github.com/pterodactyl/panel/issues/2085
                    $database->delete();

                    Log::warning($exception);
                }
            }

            // clear any allocation notes for the server
            $server->allocations()->update(['notes' => null]);

            $server->delete();
        });
    }
}
