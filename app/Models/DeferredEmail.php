<?php

namespace Everest\Models;

use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;

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
 * @property string|null $claim_token
 * @property \Illuminate\Support\Carbon|null $claimed_at
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
        'claim_token',
        'claimed_at',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'data' => 'array',
        'scheduled_at' => 'datetime',
        'sent_at' => 'datetime',
        'claimed_at' => 'datetime',
        'attempts' => 'integer',
    ];

    /**
     * How long a claim is honoured before another run may take the rows back.
     *
     * Long enough that a slow dispatch loop is never overtaken, short enough
     * that a worker killed mid-loop does not strand its batch for an hour.
     */
    public const CLAIM_LEASE_MINUTES = 15;

    /**
     * Exclusively claim a batch of due deferred emails.
     *
     * This replaces a plain SELECT that let two concurrent runs read — and
     * send — the same rows. The candidate ids are locked, stamped with a token,
     * and only then read back, so a row belongs to exactly one caller.
     *
     * Rows whose lease has expired are reclaimed: the only way a claim outlives
     * its holder is the holder dying, and those emails still need to go out.
     *
     * `lockForUpdate` rather than `SKIP LOCKED` deliberately — the test suite
     * runs on SQLite, and this matches the locking idiom used throughout the
     * billing and backup services.
     *
     * @return \Illuminate\Database\Eloquent\Collection<int, self>
     */
    public static function claimPending(int $limit = 100): \Illuminate\Database\Eloquent\Collection
    {
        $token = (string) Str::uuid();

        $claimed = DB::transaction(function () use ($limit, $token) {
            $expiry = now()->subMinutes(self::CLAIM_LEASE_MINUTES);

            $ids = static::query()
                ->whereNull('sent_at')
                ->where('scheduled_at', '<=', now())
                ->where(fn ($q) => $q->whereNull('claimed_at')->orWhere('claimed_at', '<', $expiry))
                ->orderBy('scheduled_at')
                ->limit($limit)
                ->lockForUpdate()
                ->pluck('id')
                ->all();

            if ($ids === []) {
                return 0;
            }

            return static::query()
                ->whereIn('id', $ids)
                ->update(['claim_token' => $token, 'claimed_at' => now()]);
        });

        if ($claimed === 0) {
            return new \Illuminate\Database\Eloquent\Collection();
        }

        return static::query()
            ->where('claim_token', $token)
            ->orderBy('scheduled_at')
            ->get();
    }

    /**
     * Mark as sent and release the claim.
     *
     * The row is kept rather than deleted: it is the only record that a
     * deferred email was ever handed back to the queue, and `sent_at` is what
     * keeps it out of the next claim.
     */
    public function markAsSent(): void
    {
        $this->sent_at = now();
        $this->claim_token = null;
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
     * Record that this row has been handed back to the mail queue.
     *
     * One write rather than incrementAttempts() + markAsSent(), which would be
     * two UPDATEs per row across a batch of a hundred.
     */
    public function markDispatched(): void
    {
        $this->forceFill([
            'attempts' => $this->attempts + 1,
            'sent_at' => now(),
            'claim_token' => null,
        ])->save();
    }

    /**
     * Relationship: Get the user associated with this deferred email.
     */
    public function user(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
