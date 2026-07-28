<?php

namespace Everest\Http\Controllers\Api\Remote\Backups;

use Everest\Models\Backup;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Everest\Http\Controllers\Controller;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Database\ConnectionInterface;
use Everest\Extensions\Backups\BackupManager;
use Everest\Extensions\Filesystem\S3Filesystem;
use Everest\Extensions\Backups\S3MultipartUploadLimits;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Everest\Http\Middleware\Api\Daemon\DaemonBackupAuthorization;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

class BackupRemoteUploadController extends Controller
{
    public const DEFAULT_MAX_PART_SIZE = S3MultipartUploadLimits::MAX_PART_SIZE;

    /**
     * BackupRemoteUploadController constructor.
     */
    public function __construct(
        private BackupManager $backupManager,
        private ConnectionInterface $connection,
    ) {
    }

    /**
     * Returns the required presigned urls to upload a backup to S3 cloud storage.
     *
     * @throws \Exception
     * @throws \Throwable
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException
     */
    public function __invoke(Request $request, string $backup): JsonResponse
    {
        /** @var Backup $backup */
        $backup = $request->attributes->get(DaemonBackupAuthorization::BACKUP_ATTRIBUTE);

        // Parse the exact decimal representation before casting so values such as
        // negatives, floats, exponents, overflow, and arrays cannot be normalized
        // into attacker-controlled work.
        $size = $this->parseSize($request);

        // Prevent backups that have already been completed from trying to
        // be uploaded again.
        if (!is_null($backup->completed_at)) {
            throw new ConflictHttpException('This backup is already in a completed state.');
        }

        $maxPartSize = S3MultipartUploadLimits::partSize();
        $maximumSize = S3MultipartUploadLimits::maximumObjectSize();
        if ($size > $maximumSize) {
            throw new BadRequestHttpException(sprintf('The requested backup size exceeds the %d byte multipart limit.', $maximumSize));
        }

        $partCount = intdiv($size - 1, $maxPartSize) + 1;
        $maximumParts = S3MultipartUploadLimits::maximumPresignedParts();
        if ($partCount > $maximumParts) {
            throw new BadRequestHttpException(sprintf('The requested backup requires more than %d upload parts.', $maximumParts));
        }

        $this->hitNodeRateLimit($backup->server->node_id, $partCount);

        // Ensure we are using the S3 adapter.
        $adapter = $this->backupManager->adapter();
        if (!$adapter instanceof S3Filesystem) {
            throw new BadRequestHttpException('The configured backup adapter is not an S3 compatible adapter.');
        }

        // The path where backup will be uploaded to
        $path = sprintf('%s/%s.tar.gz', $backup->server->uuid, $backup->uuid);

        // Get the S3 client
        $client = $adapter->getClient();
        $expires = CarbonImmutable::now()->addMinutes(config('backups.presigned_url_lifespan', 60));

        // Params for generating the presigned urls
        $params = [
            'Bucket' => $adapter->getBucket(),
            'Key' => $path,
            'ContentType' => 'application/x-gzip',
        ];

        $storageClass = config('backups.disks.s3.storage_class');
        if (!is_null($storageClass)) {
            $params['StorageClass'] = $storageClass;
        }

        $uploadId = null;
        $createdProviderUploadId = null;
        $uploadStatePersisted = false;
        try {
            // Serialize initialization on the backup row. Lost responses and
            // concurrent retries must reuse the durable upload identifier rather
            // than creating an untracked multipart upload.
            [$uploadId] = $this->connection->transaction(function () use ($backup, $client, $params, $size, &$createdProviderUploadId): array {
                /** @var Backup $locked */
                $locked = Backup::query()->whereKey($backup->id)->lockForUpdate()->firstOrFail();
                if (!is_null($locked->completed_at)) {
                    throw new ConflictHttpException('This backup is already in a completed state.');
                }

                if (is_string($locked->upload_id) && $locked->upload_id !== '') {
                    if ($locked->upload_size !== null && (int) $locked->upload_size !== $size) {
                        throw new ConflictHttpException('This multipart upload is already bound to a different size.');
                    }
                    if ($locked->upload_size === null) {
                        $locked->forceFill(['upload_size' => $size])->saveOrFail();
                    }

                    return [$locked->upload_id];
                }

                $result = $client->execute($client->getCommand('CreateMultipartUpload', $params));
                $identifier = $result->get('UploadId');
                if (!is_string($identifier) || $identifier === '') {
                    throw new \UnexpectedValueException('Object storage did not return a multipart upload identifier.');
                }
                // A failed save or transaction commit prevents the closure's
                // return value from reaching the outer scope, but the provider
                // upload already exists and must still be aborted.
                $createdProviderUploadId = $identifier;

                $locked->forceFill([
                    'upload_id' => $identifier,
                    'upload_size' => $size,
                ])->saveOrFail();

                return [$identifier];
            });
            $uploadStatePersisted = true;
            $params['UploadId'] = $uploadId;

            $parts = [];
            for ($i = 1; $i <= $partCount; ++$i) {
                $parts[] = $client->createPresignedRequest(
                    $client->getCommand('UploadPart', array_merge($params, ['PartNumber' => $i])),
                    $expires
                )->getUri()->__toString();
            }
        } catch (\Throwable $exception) {
            // Abort only when provider creation escaped a failed database
            // transaction. Once the identifier is durable, a concurrent retry
            // may already be using it and signing failures must remain retryable.
            if ($createdProviderUploadId !== null && !$uploadStatePersisted) {
                $this->abortIncompleteUpload($backup, $adapter, $path, $createdProviderUploadId);
            }

            throw $exception;
        }

        return new JsonResponse([
            'parts' => $parts,
            'part_size' => $maxPartSize,
        ]);
    }

    /**
     * Parse a canonical positive decimal integer that fits in PHP's integer range.
     */
    private function parseSize(Request $request): int
    {
        $value = $request->query('size');
        if (!is_string($value) || !preg_match('/^[1-9][0-9]*$/D', $value)) {
            throw new BadRequestHttpException('The "size" query parameter must be a canonical positive integer.');
        }

        $maximum = (string) PHP_INT_MAX;
        if (strlen($value) > strlen($maximum) || (strlen($value) === strlen($maximum) && strcmp($value, $maximum) > 0)) {
            throw new BadRequestHttpException('The "size" query parameter exceeds the supported integer range.');
        }

        return (int) $value;
    }

    /**
     * Apply the expensive-work budget to the authenticated node, not its IP.
     */
    private function hitNodeRateLimit(int $nodeId, int $partCount): void
    {
        $prefix = 'remote-backup-upload:' . $nodeId;
        $period = max(1, (int) config('backups.remote_upload_rate_period', 60));
        $requestLimit = max(1, (int) config('backups.remote_upload_rate_limit', 60));
        $partLimit = max(1, (int) config('backups.remote_upload_part_limit', 5_000));

        $requestKey = $prefix . ':requests';
        if (RateLimiter::increment($requestKey, $period) > $requestLimit) {
            $this->throwRateLimitException($requestKey);
        }

        $partKey = $prefix . ':parts';
        if (RateLimiter::increment($partKey, $period, $partCount) > $partLimit) {
            $this->throwRateLimitException($partKey);
        }
    }

    private function throwRateLimitException(string $key): never
    {
        $retryAfter = RateLimiter::availableIn($key);

        throw new ThrottleRequestsException('Too many backup upload requests.', null, ['Retry-After' => (string) $retryAfter]);
    }

    /**
     * Best-effort cleanup for a multipart upload whose URL batch could not be signed.
     */
    private function abortIncompleteUpload(Backup $backup, S3Filesystem $adapter, string $path, string $uploadId): void
    {
        try {
            $client = $adapter->getClient();
            $client->execute($client->getCommand('AbortMultipartUpload', [
                'Bucket' => $adapter->getBucket(),
                'Key' => $path,
                'UploadId' => $uploadId,
            ]));
        } catch (\Throwable $exception) {
            Log::warning('Failed to abort an incomplete backup multipart upload.', [
                'backup_uuid' => $backup->uuid,
                'exception_class' => $exception::class,
            ]);

            return;
        }

        try {
            Backup::query()
                ->whereKey($backup->id)
                ->where('upload_id', $uploadId)
                ->update(['upload_id' => null, 'upload_size' => null]);
            $backup->upload_id = null;
            $backup->upload_size = null;
        } catch (\Throwable $exception) {
            Log::warning('Multipart upload was aborted but its backup state could not be cleared.', [
                'backup_uuid' => $backup->uuid,
                'exception_class' => $exception::class,
            ]);
        }
    }
}
