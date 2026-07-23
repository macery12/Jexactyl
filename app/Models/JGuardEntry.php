<?php

namespace Everest\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $user_id
 * @property string $status pending|approved|rejected
 * @property string $approval_mode manual|delayed|immediate
 * @property Carbon|null $expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property User|null $user
 */
class JGuardEntry extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';

    public const MODE_MANUAL = 'manual';
    public const MODE_DELAYED = 'delayed';
    public const MODE_IMMEDIATE = 'immediate';

    protected $table = 'jguard_delay';

    protected $fillable = [
        'user_id',
        'status',
        'approval_mode',
        'expires_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isPending(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && Carbon::now()->isAfter($this->expires_at);
    }
}
