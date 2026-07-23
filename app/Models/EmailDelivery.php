<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Everest\Models\EmailDelivery.
 *
 * @property int $id
 * @property string $correlation_id
 * @property string|null $template_key
 * @property string $recipient
 * @property int|null $user_id
 * @property string $subject
 * @property string $provider
 * @property string $status
 * @property int $attempts
 * @property \Carbon\Carbon|null $last_attempt_at
 * @property \Carbon\Carbon|null $sent_at
 * @property string|null $last_message_id
 * @property int|null $last_status_code
 * @property string|null $last_error
 * @property array|null $tags
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 * @property User|null $user
 * @property \Illuminate\Database\Eloquent\Collection|EmailDeliveryAttempt[] $deliveryAttempts
 */
class EmailDelivery extends Model
{
    public const STATUS_QUEUED = 'queued';
    public const STATUS_SENDING = 'sending';
    public const STATUS_SENT = 'sent';
    public const STATUS_DEFERRED = 'deferred';
    public const STATUS_SKIPPED = 'skipped';
    public const STATUS_FAILED = 'failed';

    public static function statuses(): array
    {
        return [
            self::STATUS_QUEUED,
            self::STATUS_SENDING,
            self::STATUS_SENT,
            self::STATUS_DEFERRED,
            self::STATUS_SKIPPED,
            self::STATUS_FAILED,
        ];
    }

    /**
     * The table associated with the model.
     */
    protected $table = 'email_deliveries';

    protected $fillable = [
        'correlation_id',
        'template_key',
        'recipient',
        'user_id',
        'subject',
        'provider',
        'status',
        'attempts',
        'last_attempt_at',
        'sent_at',
        'last_message_id',
        'last_status_code',
        'last_error',
        'tags',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'attempts' => 'integer',
        'last_status_code' => 'integer',
        'last_attempt_at' => 'datetime',
        'sent_at' => 'datetime',
        'tags' => 'array',
    ];

    /**
     * Get the user associated with this email delivery.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get all delivery attempts for this email.
     */
    public function deliveryAttempts(): HasMany
    {
        return $this->hasMany(EmailDeliveryAttempt::class, 'delivery_id')
            ->orderBy('attempt_number');
    }

    /**
     * Get the latest delivery attempt.
     */
    public function latestAttempt()
    {
        return $this->hasOne(EmailDeliveryAttempt::class, 'delivery_id')
            ->latestOfMany('attempt_number');
    }

    /**
     * Scope: Filter by status.
     */
    public function scopeWithStatus($query, string $status)
    {
        return $query->where('status', $status);
    }

    /**
     * Scope: Filter by template key.
     */
    public function scopeWithTemplate($query, string $templateKey)
    {
        return $query->where('template_key', $templateKey);
    }

    /**
     * Scope: Filter by date range.
     */
    public function scopeWithinDateRange($query, string $startDate, string $endDate)
    {
        return $query->whereBetween('created_at', [$startDate, $endDate]);
    }

    /**
     * Scope: Only failures.
     */
    public function scopeOnlyFailures($query)
    {
        return $query->where('status', self::STATUS_FAILED);
    }

    /**
     * Scope: Only successful deliveries.
     */
    public function scopeOnlySuccessful($query)
    {
        return $query->where('status', self::STATUS_SENT);
    }

    /**
     * Get the display timestamp (sent_at if sent, otherwise created_at).
     */
    public function getDisplayTimestampAttribute(): \Carbon\Carbon
    {
        return $this->sent_at ?? $this->created_at;
    }

    /**
     * Check if delivery was successful.
     */
    public function isSuccessful(): bool
    {
        return $this->status === self::STATUS_SENT;
    }

    /**
     * Check if delivery failed.
     */
    public function isFailed(): bool
    {
        return $this->status === self::STATUS_FAILED;
    }

    /**
     * Check if delivery is pending.
     */
    public function isPending(): bool
    {
        return in_array($this->status, [self::STATUS_QUEUED, self::STATUS_SENDING, self::STATUS_DEFERRED], true);
    }
}
