<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AiConversation extends Model
{
    protected $table = 'ai_conversations';

    protected $fillable = [
        'user_id',
        'server_uuid',
        'scope',
        'title',
        'is_saved',
        'expires_at',
    ];

    /** Conversations opened from a server's own assistant. */
    public const SCOPE_SERVER = 'server';

    /** Conversations opened from the admin assistant, which have no server. */
    public const SCOPE_ADMIN = 'admin';

    protected $casts = [
        'is_saved' => 'boolean',
        'expires_at' => 'datetime',
    ];

    /** How many days before an unsaved conversation expires. */
    public const EXPIRY_DAYS = 7;

    /** Max unsaved conversations kept per user (oldest are pruned on create). */
    public const MAX_UNSAVED_PER_USER = 30;

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_uuid', 'uuid');
    }

    public function messages(): HasMany
    {
        // Ordered by id, not created_at: an agent turn writes several messages
        // within the same second, and the column has no sub-second precision,
        // so timestamps alone would shuffle a turn's tool steps.
        return $this->hasMany(AiMessage::class, 'conversation_id')->orderBy('id');
    }
}
