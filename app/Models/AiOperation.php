<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A long-running operation the agent started.
 *
 * Backups, archive extraction and restores all take minutes — far longer than
 * a chat turn. The handle is what lets the UI keep reporting progress after the
 * turn's stream has closed, and lets a later turn ask whether the thing it
 * started has finished.
 */
class AiOperation extends Model
{
    protected $table = 'ai_operations';

    public const KIND_BACKUP = 'backup';
    public const KIND_RESTORE = 'restore';
    public const KIND_COMPRESS = 'compress';
    public const KIND_DECOMPRESS = 'decompress';

    public const STATUS_RUNNING = 'running';
    public const STATUS_SUCCEEDED = 'succeeded';
    public const STATUS_FAILED = 'failed';
    public const STATUS_UNKNOWN = 'unknown';

    protected $fillable = [
        'uuid',
        'conversation_id',
        'user_id',
        'server_uuid',
        'kind',
        'external_ref',
        'status',
        'progress',
        'payload',
        'error',
        'completed_at',
    ];

    protected $casts = [
        'payload' => 'array',
        'progress' => 'integer',
        'completed_at' => 'datetime',
    ];

    public function isFinished(): bool
    {
        return in_array($this->status, [self::STATUS_SUCCEEDED, self::STATUS_FAILED], true);
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_uuid', 'uuid');
    }
}
