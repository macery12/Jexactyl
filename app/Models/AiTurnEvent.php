<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One frame a turn emitted, kept so a client that lost the stream can rejoin it.
 *
 * Append-only and never updated: an event is a statement about a moment, and
 * rewriting one would make the replay disagree with what the live reader saw.
 */
class AiTurnEvent extends Model
{
    protected $table = 'ai_turn_events';

    public const UPDATED_AT = null;

    protected $fillable = [
        'turn_id',
        'seq',
        'type',
        'payload',
    ];

    protected $casts = [
        'seq' => 'integer',
        'payload' => 'array',
        'created_at' => 'datetime',
    ];
}
