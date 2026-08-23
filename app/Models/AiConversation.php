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
        'redactions',
        'assist',
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
        // token => original value, for the personal data kept out of the
        // requests this conversation made. Written so a transcript reloaded
        // tomorrow still reads as something other than `[email_1]`, and dropped
        // with the conversation when it expires.
        'redactions' => 'array',
        // The audited session open on a customer's server. Stored so a
        // follow-up question in the same conversation does not need re-approving
        // — the capability behind it is re-checked on every turn regardless, so
        // this grants nothing on its own.
        'assist' => 'array',
    ];

    /** How many days before an unsaved conversation expires. */
    public const EXPIRY_DAYS = 7;

    /** Max unsaved conversations kept per user (oldest are pruned on create). */
    public const MAX_UNSAVED_PER_USER = 30;

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return BelongsTo<Server, $this> */
    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class, 'server_uuid', 'uuid');
    }

    /** @return HasMany<AiMessage, $this> */
    public function messages(): HasMany
    {
        // Ordered by id, not created_at: id is the canonical write sequence and
        // several messages can still share the same millisecond during a turn.
        return $this->hasMany(AiMessage::class, 'conversation_id')->orderBy('id');
    }
}
