<?php

namespace Everest\Http\Controllers\Api\Remote\Backups;

use Everest\Models\Backup;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Aws\S3\S3ClientInterface;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Exceptions\DisplayException;
use Everest\Http\Controllers\Controller;
use Everest\Extensions\Backups\BackupManager;
use Everest\Extensions\Filesystem\S3Filesystem;
use Everest\Extensions\Backups\S3MultipartUploadLimits;
use Everest\Http\Middleware\Api\Daemon\DaemonBackupAuthorization;
use Everest\Http\Requests\Api\Remote\ReportBackupCompleteRequest;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

class BackupStatusController extends Controller
{
    /**
     * BackupStatusController constructor.
     */
    public function __construct(private BackupManager $backupManager)
    {
    }

    /**
     * Handles updating the state of a backup.
     *
     * @throws \Throwable
     */
    public function index(ReportBackupCompleteRequest $request, string $backup): JsonResponse
    {
        /** @var Backup $model */
        $model = $request->attributes->get(DaemonBackupAuthorization::BACKUP_ATTRIBUTE);

        if ($model->is_successful) {
            throw new BadRequestHttpException('Cannot update the status of a backup that is already marked as completed.');
        }

        $action = $request->boolean('successful') ? 'server:backup.complete' : 'server:backup.fail';
        $log = Activity::event($action)->subject($model, $model->server)->property('name', $model->name);

        $log->transaction(function () use ($model, $request) {
            $successful = $request->boolean('successful');

            $model->fill([
                'is_successful' => $successful,
                // Change the lock state to unlocked if this was a failed backup so that it can be
                // deleted easily. Also does not make sense to have a locked backup on the system
                // that is failed.
                'is_locked' => $successful ? $model->is_locked : false,
                'checksum' => $successful ? ($request->input('checksum_type') . ':' . $request->input('checksum')) : null,
                'bytes' => $successful ? $request->input('size') : 0,
                'completed_at' => CarbonImmutable::now(),
            ])->save();

            // Check if we are using the s3 backup adapter. If so, make sure we mark the backup as
            // being completed in S3 correctly.
            $adapter = $this->backupManager->adapter();
            if ($adapter instanceof S3Filesystem) {
                $this->completeMultipartUpload(
                    $model,
                    $adapter,
                    $successful,
                    (int) $request->input('size', 0),
                );
            }
        });

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Handles toggling the restoration status of a server. The server status field should be
     * set back to null, even if the restoration failed. This is not an unsolvable state for
     * the server, and the user can keep trying to restore, or just use the reinstall button.
     *
     * The only thing the successful field does is update the entry value for the audit logs
     * table tracking for this restoration.
     *
     * @throws \Throwable
     */
    public function restore(Request $request, string $backup): JsonResponse
    {
        /** @var Backup $model */
        $model = $request->attributes->get(DaemonBackupAuthorization::BACKUP_ATTRIBUTE);

        $model->server->update(['status' => null]);

        Activity::event($request->boolean('successful') ? 'server:backup.restore-complete' : 'server.backup.restore-failed')
            ->subject($model, $model->server)
            ->property('name', $model->name)
            ->log();

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Marks a multipart upload in a given S3-compatible instance as failed or successful for
     * the given backup.
     *
     * @throws \Exception
     * @throws DisplayException
     */
    protected function completeMultipartUpload(
        Backup $backup,
        S3Filesystem $adapter,
        bool $successful,
        int $reportedSize,
    ): void {
        // This should never really happen, but if it does don't let us fall victim to Amazon's
        // wildly fun error messaging. Just stop the process right here.
        if (empty($backup->upload_id)) {
            // A failed backup doesn't need to error here, this can happen if the backup encounters
            // an error before we even start the upload. AWS gives you tooling to clear these failed
            // multipart uploads as needed too.
            if (!$successful) {
                return;
            }

            throw new DisplayException('Cannot complete backup request: no upload_id present on model.');
        }

        $params = [
            'Bucket' => $adapter->getBucket(),
            'Key' => sprintf('%s/%s.tar.gz', $backup->server->uuid, $backup->uuid),
            'UploadId' => $backup->upload_id,
        ];

        $client = $adapter->getClient();
        if (!$successful) {
            $client->execute($client->getCommand('AbortMultipartUpload', $params));

            return;
        }

        [$listedParts, $actualSize] = $this->listMultipartParts($client, $params);
        if ($backup->upload_size === null) {
            // Uploads initialized before upload_size existed have no durable
            // expectation to compare against. Backfill only from the provider's
            // authoritative part total, and only when the daemon independently
            // reports that exact total. The surrounding status transaction
            // already holds the backup row through the preceding update.
            if ($reportedSize !== $actualSize) {
                throw new DisplayException('Cannot complete backup request: uploaded size does not match the reported size.');
            }
            $backup->forceFill(['upload_size' => $actualSize])->saveOrFail();
        }

        $expectedSize = (int) $backup->upload_size;
        if ($reportedSize !== $expectedSize || $actualSize !== $expectedSize) {
            throw new DisplayException('Cannot complete backup request: uploaded size does not match the authorized size.');
        }

        // Complete using the provider's authoritative part list. Caller-supplied
        // ETags and part numbers are retained in the API only for daemon
        // compatibility and are never trusted as the completion authority.
        $params['MultipartUpload'] = ['Parts' => $listedParts];
        $client->execute($client->getCommand('CompleteMultipartUpload', $params));
    }

    /**
     * Return the bounded provider-authoritative part list and its exact byte sum.
     *
     * @return array{0: array<int, array{ETag: string, PartNumber: int}>, 1: int}
     */
    private function listMultipartParts(S3ClientInterface $client, array $params): array
    {
        $maximumParts = S3MultipartUploadLimits::maximumCompletionParts();
        $parts = [];
        $totalSize = 0;
        $marker = null;

        while (true) {
            $remaining = $maximumParts - count($parts);
            if ($remaining <= 0) {
                throw new DisplayException('Cannot complete backup request: multipart part count exceeds the configured limit.');
            }

            $listParams = $params;
            $listParams['MaxParts'] = min(1000, $remaining);
            if ($marker !== null) {
                $listParams['PartNumberMarker'] = $marker;
            }

            $result = $client->execute($client->getCommand('ListParts', $listParams));
            $batch = $result['Parts'] ?? [];
            if (!is_array($batch)) {
                throw new DisplayException('Cannot complete backup request: object storage returned an invalid part list.');
            }

            foreach ($batch as $part) {
                $partNumber = (int) ($part['PartNumber'] ?? 0);
                $etag = $part['ETag'] ?? null;
                $size = $part['Size'] ?? null;
                if (
                    $partNumber < 1
                    || $partNumber > S3MultipartUploadLimits::MAX_MULTIPART_PARTS
                    || !is_string($etag)
                    || $etag === ''
                    || !is_int($size)
                    || $size < 1
                ) {
                    throw new DisplayException('Cannot complete backup request: object storage returned invalid part metadata.');
                }

                $parts[] = ['ETag' => $etag, 'PartNumber' => $partNumber];
                $totalSize += $size;
                if (
                    count($parts) > $maximumParts
                    || $totalSize > S3MultipartUploadLimits::maximumObjectSize()
                ) {
                    throw new DisplayException('Cannot complete backup request: multipart upload exceeds the configured limit.');
                }
            }

            $truncated = (bool) ($result['IsTruncated'] ?? false);
            if (!$truncated) {
                break;
            }

            $nextMarker = (int) ($result['NextPartNumberMarker'] ?? 0);
            if ($nextMarker <= (int) ($marker ?? 0)) {
                throw new DisplayException('Cannot complete backup request: object storage returned an invalid pagination marker.');
            }
            $marker = $nextMarker;
        }

        if ($parts === []) {
            throw new DisplayException('Cannot complete backup request: multipart upload contains no parts.');
        }

        return [$parts, $totalSize];
    }
}
