<?php

namespace Everest\Models;

use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single linked SSO identity. Uniqueness is enforced on both
 * (provider, provider_user_id) and (user_id, provider), so one provider account
 * maps to exactly one panel user and vice versa.
 *
 * @property int $id
 * @property int $user_id
 * @property string $provider discord|google
 * @property string $provider_user_id
 * @property string|null $provider_username
 * @property string|null $provider_email
 * @property string|null $provider_avatar
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property User|null $user
 */
class UserOAuthAccount extends Model
{
    public const PROVIDER_DISCORD = 'discord';
    public const PROVIDER_GOOGLE = 'google';

    /**
     * Providers the panel knows how to authenticate against. Anything not in
     * this list is rejected before it reaches an OAuth controller.
     */
    public const PROVIDERS = [
        self::PROVIDER_DISCORD,
        self::PROVIDER_GOOGLE,
    ];

    protected $table = 'user_oauth_accounts';

    protected $fillable = [
        'user_id',
        'provider',
        'provider_user_id',
        'provider_username',
        'provider_email',
        'provider_avatar',
    ];

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Human-readable provider name for UI copy and activity log entries.
     */
    public static function label(string $provider): string
    {
        return match ($provider) {
            self::PROVIDER_DISCORD => 'Discord',
            self::PROVIDER_GOOGLE => 'Google',
            default => ucfirst($provider),
        };
    }
}
