<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Everest\Models\Alert.
 *
 * @property int $id
 * @property string|null $title
 * @property string $content
 * @property string $type
 * @property string $position
 * @property bool $enabled
 * @property bool $dismissible
 * @property string|null $link
 * @property string|null $link_text
 * @property int $priority
 * @property \Carbon\Carbon|null $start_at
 * @property \Carbon\Carbon|null $end_at
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 */
class Alert extends Model
{
    /**
     * The table associated with the model.
     */
    protected $table = 'alerts';

    /**
     * The attributes that are mass assignable.
     */
    protected $fillable = [
        'title',
        'content',
        'type',
        'position',
        'scope',
        'user_targeting',
        'enabled',
        'dismissible',
        'show_button',
        'button_text',
        'button_position',
        'link',
        'link_text',
        'priority',
        'start_at',
        'end_at',
    ];

    /**
     * The attributes that should be cast.
     */
    protected $casts = [
        'enabled' => 'boolean',
        'dismissible' => 'boolean',
        'show_button' => 'boolean',
        'priority' => 'integer',
        'start_at' => 'datetime',
        'end_at' => 'datetime',
    ];

    /**
     * Validation rules for the model.
     */
    public static array $validationRules = [
        'title' => 'nullable|string|max:255',
        'content' => 'required|string|max:1000',
        'type' => 'required|string|in:success,info,warning,danger',
        'position' => 'required|string|in:notification,top-center,slide-out,center',
        'scope' => 'required|string|in:global,dashboard,server,billing,account,admin',
        'user_targeting' => 'required|string|in:all,specific',
        'enabled' => 'boolean',
        'dismissible' => 'boolean',
        'show_button' => 'boolean',
        'button_text' => 'nullable|string|max:50',
        'button_position' => 'nullable|string|in:bottom-right,bottom-left,top-right,top-left',
        'link' => 'nullable|url|max:500',
        'link_text' => 'nullable|string|max:100',
        'priority' => 'integer|min:0',
        'start_at' => 'nullable|date',
        'end_at' => 'nullable|date|after:start_at',
    ];

    /**
     * Get the users that this alert is targeted to.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany<User, $this>
     */
    public function users(): \Illuminate\Database\Eloquent\Relations\BelongsToMany
    {
        return $this->belongsToMany(User::class, 'alert_user')->withTimestamps();
    }

    /**
     * Scope to get only active alerts (enabled and within date range if set).
     */
    public function scopeActive($query)
    {
        return $query->where('enabled', true)
            ->where(function ($q) {
                $q->whereNull('start_at')
                    ->orWhere('start_at', '<=', now());
            })
            ->where(function ($q) {
                $q->whereNull('end_at')
                    ->orWhere('end_at', '>=', now());
            })
            ->orderByDesc('priority')
            ->orderByDesc('created_at');
    }

    /**
     * Scope to filter alerts by scope.
     */
    public function scopeForScope($query, string $scope)
    {
        return $query->where(function ($q) use ($scope) {
            $q->where('scope', $scope)
                ->orWhere('scope', 'global');
        });
    }

    /**
     * Scope to filter alerts for a specific user.
     */
    public function scopeForUser($query, int $userId)
    {
        return $query->where(function ($q) use ($userId) {
            $q->where('user_targeting', 'all')
                ->orWhereHas('users', function ($userQuery) use ($userId) {
                    $userQuery->where('users.id', $userId);
                });
        });
    }
}
