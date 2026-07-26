<?php

namespace Everest\Services\Backups;

use Ramsey\Uuid\Uuid;
use Everest\Models\Backup;
use Everest\Models\Server;
use Carbon\CarbonImmutable;
use Webmozart\Assert\Assert;
use Illuminate\Database\ConnectionInterface;
use Everest\Extensions\Backups\BackupManager;
use Everest\Repositories\Eloquent\BackupRepository;
use Everest\Repositories\Wings\DaemonBackupRepository;
use Everest\Exceptions\Service\Backup\TooManyBackupsException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

class InitiateBackupService
{
    private array $ignoredFiles = [];

    private bool $isLocked = false;

    /**
     * InitiateBackupService constructor.
     */
    public function __construct(
        private BackupRepository $repository,
        private ConnectionInterface $connection,
        private DaemonBackupRepository $daemonBackupRepository,
        private DeleteBackupService $deleteBackupService,
        private BackupManager $backupManager,
    ) {
    }

    /**
     * Set if the backup should be locked once it is created which will prevent
     * its deletion by users or automated system processes.
     */
    public function setIsLocked(bool $isLocked): self
    {
        $this->isLocked = $isLocked;

        return $this;
    }

    /**
     * Sets the files to be ignored by this backup.
     *
     * @param string[]|null $ignored
     */
    public function setIgnoredFiles(?array $ignored): self
    {
        if (is_array($ignored)) {
            foreach ($ignored as $value) {
                Assert::string($value);
            }
        }

        // Set the ignored files to be any values that are not empty in the array. Don't use
        // the PHP empty function here incase anything that is "empty" by default (0, false, etc.)
        // were passed as a file or folder name.
        $this->ignoredFiles = is_null($ignored) ? [] : array_filter($ignored, function ($value) {
            return strlen($value) > 0;
        });

        return $this;
    }

    /**
     * Initiates the backup process for a server on Wings.
     *
     * @throws \Throwable
     * @throws TooManyBackupsException
     * @throws TooManyRequestsHttpException
     */
    public function handle(Server $server, ?string $name = null, bool $override = false): Backup
    {
        return $this->connection->transaction(function () use ($server, $name, $override) {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();

            $limit = config('backups.throttles.limit');
            $period = config('backups.throttles.period');
            if ($period > 0) {
                $previous = $this->repository->getBackupsGeneratedDuringTimespan($lockedServer->id, $period);
                if ($previous->count() >= $limit) {
                    $message = sprintf('Only %d backups may be generated within a %d second span of time.', $limit, $period);

                    throw new TooManyRequestsHttpException(CarbonImmutable::now()->diffInSeconds($previous->last()->created_at->addSeconds($period)), $message);
                }
            }

            // Re-check the quota while holding a stable per-server row lock.
            // Every path through this service is serialized until the durable
            // backup reservation has been created.
            $successful = $this->repository->getNonFailedBackups($lockedServer);
            if (!$lockedServer->backup_limit || $successful->count() >= $lockedServer->backup_limit) {
                if (!$override || $lockedServer->backup_limit <= 0) {
                    throw new TooManyBackupsException($lockedServer->backup_limit);
                }

                $oldest = $successful->where('is_locked', false)->orderBy('created_at')->first();
                if (!$oldest) {
                    throw new TooManyBackupsException($lockedServer->backup_limit);
                }

                /* @var Backup $oldest */
                $this->deleteBackupService->handle($oldest);
            }

            /** @var Backup $backup */
            $backup = $this->repository->create([
                'server_id' => $lockedServer->id,
                'uuid' => Uuid::uuid4()->toString(),
                'name' => trim($name) ?: sprintf('Backup at %s', CarbonImmutable::now()->toDateTimeString()),
                'ignored_files' => array_values($this->ignoredFiles),
                'disk' => $this->backupManager->getDefaultAdapter(),
                'is_locked' => $this->isLocked,
            ], true, true);

            $this->daemonBackupRepository->setServer($lockedServer)
                ->setBackupAdapter($this->backupManager->getDefaultAdapter())
                ->backup($backup);

            return $backup;
        });
    }
}
