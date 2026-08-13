<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Audit record for one agent tool call.
 *
 * Complements rather than duplicates the activity log. Activity logs record
 * what the panel did and deliberately redact console command text; this
 * records what the *model* asked for — arguments included — plus the approval
 * decision, which is the only way to review an AI-driven change after the fact.
 */
class AiToolCall extends Model
{
    protected $table = 'ai_tool_calls';

    public $timestamps = false;

    public const STATUS_PENDING_APPROVAL = 'pending_approval';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_RUNNING = 'running';
    public const STATUS_SUCCEEDED = 'succeeded';
    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'turn_id',
        'conversation_id',
        'user_id',
        'server_uuid',
        'scope',
        'tool_name',
        'risk',
        'step',
        'arguments',
        'result_summary',
        'status',
        'http_status',
        'duration_ms',
        'resolved_at',
    ];

    protected $casts = [
        'arguments' => 'array',
        'step' => 'integer',
        'http_status' => 'integer',
        'duration_ms' => 'integer',
        'created_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_uuid', 'uuid');
    }
}
