<?php

namespace Everest\Models;

/**
 * Everest\Models\DeferredEmail.
 *
 * @property int $id
 * @property int $user_id
 * @property string $template_key
 * @property string $recipient
 * @property array $data
 * @property string|null $correlation_id
 * @property string $reason
 * @property \Illuminate\Support\Carbon $scheduled_at
 * @property \Illuminate\Support\Carbon|null $sent_at
 * @property int $attempts
 * @property \Illuminate\Support\Carbon $created_at
 * @property \Illuminate\Support\Carbon $updated_at
 */
class DeferredEmail extends Model
{
    protected $table = 'deferred_emails';

    protected $fillable = [
        'user_id',
        'template_key',
        'recipient',
        'data',
        'correlation_id',
        'reason',
        'scheduled_at',
        'sent_at',
        'attempts',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'data' => 'array',
        'scheduled_at' => 'datetime',
        'sent_at' => 'datetime',
        'attempts' => 'integer',
    ];

    /**
     * Get pending deferred emails ready to send.
     */
    public static function getPendingEmails(int $limit = 100): \Illuminate\Database\Eloquent\Collection
    {
        return static::whereNull('sent_at')
            ->where('scheduled_at', '<=', now())
            ->orderBy('scheduled_at')
            ->limit($limit)
            ->get();
    }

    /**
     * Mark as sent.
     */
    public function markAsSent(): void
    {
        $this->sent_at = now();
        $this->save();
    }

    /**
     * Increment attempt counter.
     */
    public function incrementAttempts(): void
    {
        ++$this->attempts;
        $this->save();
    }

    /**
     * Relationship: Get the user associated with this deferred email.
     */
    public function user(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
