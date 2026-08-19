<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One retrieval event: a search, a load, an eviction, a refusal.
 *
 * Answers the questions an operator cannot otherwise ask about a retrieval-based
 * agent — whether searches are finding anything, how many schemas a turn really
 * costs, and which tasks are dying on a prerequisite nobody can grant. Without
 * it the failure mode is invisible by construction: a model that cannot find a
 * tool does not report an error, it produces a confident answer about a
 * capability the panel supposedly lacks.
 *
 * Deliberately not an audit. {@see AiToolCall} is the record of what was done;
 * this is the record of what was *considered*, and is safe to truncate.
 */
class AiToolDiscovery extends Model
{
    protected $table = 'ai_tool_discovery';

    public $timestamps = false;

    /** A `search_tools` call and what it matched. */
    public const EVENT_SEARCH = 'search';

    /** Tools entering the working set, by search, by name, or as a gateway. */
    public const EVENT_LOAD = 'load';

    /** The offered set at the top of a step. */
    public const EVENT_OFFER = 'offer';

    /** A pin the budget could not hold. */
    public const EVENT_EVICT = 'evict';

    /** A load refused because the required set would not fit. */
    public const EVENT_OVERFLOW = 'overflow';

    /** A call the model made that resolved but was not loaded. */
    public const EVENT_NOT_LOADED = 'not_loaded';

    /** A tool that exists but this authority cannot reach. */
    public const EVENT_UNAVAILABLE = 'unavailable';

    /** The turn stopped because it was repeating itself. */
    public const EVENT_REPEAT_STOP = 'repeat_stop';

    protected $fillable = [
        'turn_id',
        'conversation_id',
        'user_id',
        'step',
        'scope',
        'phase',
        'event',
        'query',
        'matches',
        'working_set',
        'catalogue_size',
        'budget',
        'schema_bytes',
        'profile',
        'reason',
    ];

    protected $casts = [
        'matches' => 'array',
        'working_set' => 'array',
        'step' => 'integer',
        'catalogue_size' => 'integer',
        'budget' => 'integer',
        'schema_bytes' => 'integer',
        'created_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AiConversation::class, 'conversation_id');
    }
}
