<?php

namespace Everest\Extensions\Backups;

final class S3MultipartUploadLimits
{
    public const MIN_PART_SIZE = 5 * 1024 * 1024;
    public const MAX_PART_SIZE = 5 * 1024 * 1024 * 1024;
    public const MAX_MULTIPART_PARTS = 10_000;
    public const DEFAULT_MAX_PRESIGNED_PARTS = 1_000;

    /**
     * S3's current multipart object ceiling is the maximum part size
     * multiplied by the maximum number of parts (50,000 GiB).
     */
    public const MAX_OBJECT_SIZE = self::MAX_PART_SIZE * self::MAX_MULTIPART_PARTS;

    public static function partSize(): int
    {
        $partSize = (int) config('backups.max_part_size', self::MAX_PART_SIZE);
        if ($partSize < self::MIN_PART_SIZE || $partSize > self::MAX_PART_SIZE) {
            return self::MAX_PART_SIZE;
        }

        return $partSize;
    }

    public static function maximumObjectSize(): int
    {
        $maximum = (int) config('backups.max_multipart_size', self::MAX_OBJECT_SIZE);
        if ($maximum <= 0) {
            return self::MAX_OBJECT_SIZE;
        }

        return min($maximum, self::MAX_OBJECT_SIZE);
    }

    public static function maximumPresignedParts(): int
    {
        $maximum = (int) config('backups.max_presigned_parts', self::DEFAULT_MAX_PRESIGNED_PARTS);

        return min(self::MAX_MULTIPART_PARTS, max(1, $maximum));
    }

    public static function maximumCompletionParts(): int
    {
        $maximum = (int) config('backups.max_completion_parts', self::MAX_MULTIPART_PARTS);

        return min(self::MAX_MULTIPART_PARTS, max(1, $maximum));
    }
}
