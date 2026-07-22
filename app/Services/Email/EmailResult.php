<?php

namespace Everest\Services\Email;

use Everest\Models\EmailDelivery;

class EmailResult
{
    public function __construct(
        public bool $success,
        public ?string $messageId = null,
        public ?string $error = null,
        public ?int $statusCode = null,
        public ?string $status = null,
        public ?string $reason = null,
        public ?bool $retryable = null,
        public array $meta = [],
    ) {
    }

    /**
     * Create a successful result.
     */
    public static function success(string $messageId, ?int $statusCode = null): self
    {
        return new self(
            success: true,
            messageId: $messageId,
            statusCode: $statusCode,
            status: EmailDelivery::STATUS_SENT,
            retryable: null
        );
    }

    /**
     * Create a skipped result for invalid or test-domain recipients.
     */
    public static function skipped(string $reason): self
    {
        return new self(
            success: false,
            status: EmailDelivery::STATUS_SKIPPED,
            reason: $reason,
            retryable: false
        );
    }

    /**
     * Create a blocked result (subset of skipped).
     */
    public static function blocked(string $reason = 'blocked_recipient'): self
    {
        return self::skipped($reason);
    }

    /**
     * Create a failed result.
     */
    public static function failure(string $error, ?int $statusCode = null, ?bool $retryable = true): self
    {
        return new self(
            success: false,
            error: $error,
            statusCode: $statusCode,
            status: EmailDelivery::STATUS_FAILED,
            retryable: $retryable
        );
    }
}
