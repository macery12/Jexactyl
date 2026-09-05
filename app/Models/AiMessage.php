<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiMessage extends Model
{
    protected $table = 'ai_messages';

    public $timestamps = false;

    public const ROLE_USER = 'user';
    public const ROLE_ASSISTANT = 'assistant';
    public const ROLE_SYSTEM = 'system';
    public const ROLE_TOOL = 'tool';

    public const ROLES = [self::ROLE_USER, self::ROLE_ASSISTANT, self::ROLE_SYSTEM, self::ROLE_TOOL];

    protected $fillable = [
        'conversation_id',
        'role',
        'content',
        'tool_calls',
        'tool_call_id',
        'tool_name',
        'step',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'tool_calls' => 'array',
        'step' => 'integer',
    ];

    /** @return BelongsTo<AiConversation, $this> */
    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }
}
