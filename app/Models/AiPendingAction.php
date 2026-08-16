<?php

namespace Everest\Models;

use Illuminate\Support\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A turn suspended mid-flight, waiting on a human decision.
 *
 * The turn's whole conversation state is persisted here because an approval
 * can arrive minutes after the SSE connection that produced the prompt has
 * closed — holding the turn in memory would mean either pinning a PHP worker
 * for the duration or losing the work.
 */
class AiPendingAction extends Model
{
    protected $table = 'ai_pending_actions';

    public const STATUS_PENDING = 'pending';
    public const STATUS_EXECUTING = 'executing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_EXPIRED = 'expired';

    /**
     * How long a user has to decide. Long enough to go and look at the server,
     * short enough that the state it was planned against is probably still true.
     */
    public const EXPIRY_MINUTES = 30;

    protected $fillable = [
        'turn_id',
        'conversation_id',
        'user_id',
        'server_uuid',
        'scope',
        'tool_name',
        'tool_call_id',
        'risk',
        'arguments',
        'state',
        'assist_grant',
        'assist_grant_mac',
        'step',
        'status',
        'execution_key',
        'claimed_at',
        'resolved_at',
        'failure_reason',
        'expires_at',
    ];

    protected $casts = [
        'arguments' => 'array',
        'state' => 'array',
        'assist_grant' => 'array',
        'step' => 'integer',
        'expires_at' => 'datetime',
        'claimed_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];

    public function scopeActionable(Builder $query): Builder
    {
        return $query->where('status', self::STATUS_PENDING)
            ->where('expires_at', '>', Carbon::now());
    }

    public function isActionable(): bool
    {
        return $this->status === self::STATUS_PENDING
            && $this->expires_at !== null
            && $this->expires_at->isFuture();
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
