<?php

namespace Everest\Services\Servers;

use Everest\Models\Egg;
use Everest\Models\Server;
use Illuminate\Support\Facades\Log;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\ConnectionInterface;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Repositories\Wings\DaemonServerRepository;

class ChangeServerEggService
{
    /**
     * ChangeServerEggService constructor.
     */
    public function __construct(
        private ConnectionInterface $connection,
        private DaemonServerRepository $daemonServerRepository,
        private DaemonFileRepository $daemonFileRepository,
        private ReinstallServerService $reinstallService,
    ) {
    }

    /**
     * Change a server's egg and trigger a reinstall.
     *
     * @throws \Throwable
     * @throws DisplayException
     */
    public function handle(Server $server, int $newEggId, bool $deleteFiles = false): Server
    {
        // Validate server state
        if ($server->status !== null) {
            throw new DisplayException('The server must be stopped before changing eggs.');
        }

        // Validate server is installed
        if (!$server->isInstalled()) {
            throw new DisplayException('The server must be installed before changing eggs.');
        }

        // Validate that the new egg exists
        $newEgg = Egg::find($newEggId);
        if (!$newEgg) {
            throw new DisplayException('The selected egg does not exist.');
        }

        // Ensure the egg is from the same nest
        if ($newEgg->nest_id !== $server->nest_id) {
            throw new DisplayException('The selected egg must be from the same nest as the server.');
        }

        return $this->connection->transaction(function () use ($server, $newEgg, $deleteFiles) {
            // Validate that docker images are available
            if (empty($newEgg->docker_images) || !is_array($newEgg->docker_images)) {
                throw new DisplayException('The selected egg does not have any Docker images configured.');
            }

            // Delete all files if requested
            if ($deleteFiles) {
                try {
                    // Get list of all files and folders in the root directory
                    $fileRepository = $this->daemonFileRepository->setServer($server);
                    $files = $fileRepository->getDirectory('/');

                    // Extract file names from the directory listing
                    $fileNames = array_map(function ($file) {
                        return $file['name'];
                    }, $files);

                    // Delete all files and folders if any exist
                    if (!empty($fileNames)) {
                        $fileRepository->deleteFiles('/', $fileNames);

                        Log::info('Deleted all server files during egg change', [
                            'server_id' => $server->id,
                            'file_count' => count($fileNames),
                        ]);
                    }
                } catch (\Exception $e) {
                    // Log but don't fail - the server will be reinstalled anyway
                    Log::warning('Failed to delete server files during egg change', [
                        'server_id' => $server->id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }

            // Update the server's egg and related configuration
            $server->update([
                'egg_id' => $newEgg->id,
                'startup' => $newEgg->startup,
                'image' => current($newEgg->docker_images),
            ]);

            // Refresh to get updated relationships
            $server->refresh();

            // Sync the updated server configuration to the daemon
            $this->daemonServerRepository->setServer($server)->sync();

            // Trigger reinstall (which will wipe filesystem automatically)
            $this->reinstallService->handle($server);

            return $server->refresh();
        });
    }
}
