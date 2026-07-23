<?php

namespace Everest\Models;

use Everest\Services\Email\EmailRedactor;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Everest\Models\EmailDeliveryAttempt.
 *
 * @property int $id
 * @property int $delivery_id
 * @property int $attempt_number
 * @property \Carbon\Carbon|null $started_at
 * @property \Carbon\Carbon|null $finished_at
 * @property int|null $duration_ms
 * @property bool $success
 * @property string $status
 * @property string|null $provider_message_id
 * @property int|null $status_code
 * @property string|null $error
 * @property array|null $request_payload
 * @property string|null $response_payload
 * @property string|null $exception_class
 * @property string|null $stacktrace
 * @property \Carbon\Carbon $created_at
 */
class EmailDeliveryAttempt extends Model
{
    /**
     * The table associated with the model.
     */
    protected $table = 'email_delivery_attempts';

    /**
     * Indicates if the model should be timestamped.
     */
    public $timestamps = false;

    protected $fillable = [
        'delivery_id',
        'attempt_number',
        'started_at',
        'finished_at',
        'duration_ms',
        'success',
        'status',
        'provider_message_id',
        'status_code',
        'error',
        'request_payload',
        'response_payload',
        'exception_class',
        'stacktrace',
    ];

    protected $casts = [
        'delivery_id' => 'integer',
        'attempt_number' => 'integer',
        'duration_ms' => 'integer',
        'status_code' => 'integer',
        'success' => 'boolean',
        'started_at' => 'datetime',
        'finished_at' => 'datetime',
        'created_at' => 'datetime',
        'request_payload' => 'array',
    ];

    /**
     * Get the delivery this attempt belongs to.
     */
    public function delivery(): BelongsTo
    {
        return $this->belongsTo(EmailDelivery::class, 'delivery_id');
    }

    /**
     * Get sanitized request payload (redact sensitive data).
     */
    public function getSanitizedRequestPayload(): ?array
    {
        if (!$this->request_payload) {
            return null;
        }

        return $this->sanitizePayload($this->request_payload);
    }

    /**
     * Sanitize payload by redacting sensitive keys.
     */
    private function sanitizePayload(array $payload): array
    {
        return EmailRedactor::redactSensitivePayload($payload, ['api_key', 'token', 'password', 'secret', 'authorization']);
    }

    /**
     * Calculate duration from start to finish.
     */
    public function calculateDuration(): void
    {
        if ($this->started_at && $this->finished_at) {
            $this->duration_ms = (int) $this->started_at->diffInMilliseconds($this->finished_at);
        }
    }
}
