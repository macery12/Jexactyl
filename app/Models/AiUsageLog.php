<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiUsageLog extends Model
{
    /**
     * Log rows are write-once — no need for updated_at.
     */
    public $timestamps = false;

    protected $table = 'ai_usage_logs';

    protected $fillable = [
        'user_id',
        'server_uuid',
        'conversation_id',
        'model',
        'source',
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'latency_ms',
        'status',
        'cached',
        'error_message',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'cached' => 'boolean',
        'prompt_tokens' => 'integer',
        'completion_tokens' => 'integer',
        'total_tokens' => 'integer',
        'latency_ms' => 'integer',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_uuid', 'uuid');
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }
}
