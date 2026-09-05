<?php

namespace Everest\Models;

use Everest\Rules\Username;
use Everest\Facades\Activity;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rules\In;
use Illuminate\Auth\Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Builder;
use Everest\Models\Traits\HasAccessTokens;
use Illuminate\Auth\Passwords\CanResetPassword;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\Access\Authorizable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphToMany;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Contracts\Auth\Access\Authorizable as AuthorizableContract;
use Illuminate\Contracts\Auth\CanResetPassword as CanResetPasswordContract;

/**
 * Everest\Models\User.
 *
 * @property int $id
 * @property string|null $external_id
 * @property string $uuid
 * @property string $username
 * @property string $email
 * @property string|null $stripe_id
 * @property string $password
 * @property string|null $remember_token
 * @property string $language
 * @property int|null $admin_role_id
 * @property bool $root_admin
 * @property string|null $state
 * @property bool $use_totp
 * @property string|null $totp_secret
 * @property \Illuminate\Support\Carbon|null $totp_authenticated_at
 * @property \Illuminate\Support\Carbon|null $email_verified_at
 * @property bool $gravatar
 * @property bool $recovery_code_seen
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property string $avatar_url
 * @property Billing\UserBillingProfile|null $billingProfile
 * @property string $recovery_code
 * @property string|null $admin_role_name
 * @property bool $email_verified
 * @property string $md5
 * @property AdminRole|null $adminRole
 * @property \Illuminate\Database\Eloquent\Collection|ApiKey[] $apiKeys
 * @property int|null $api_keys_count
 * @property \Illuminate\Notifications\DatabaseNotificationCollection|\Illuminate\Notifications\DatabaseNotification[] $notifications
 * @property int|null $notifications_count
 * @property \Illuminate\Database\Eloquent\Collection|RecoveryToken[] $recoveryTokens
 * @property int|null $recovery_tokens_count
 * @property \Illuminate\Database\Eloquent\Collection|UserOAuthAccount[] $oauthAccounts
 * @property int|null $oauth_accounts_count
 * @property \Illuminate\Database\Eloquent\Collection|Server[] $servers
 * @property int|null $servers_count
 * @property \Illuminate\Database\Eloquent\Collection|ServerGroup[] $serverGroups
 * @property \Illuminate\Database\Eloquent\Collection|Ticket[] $tickets
 * @property \Illuminate\Database\Eloquent\Collection|UserSSHKey[] $sshKeys
 * @property int|null $ssh_keys_count
 * @property \Illuminate\Database\Eloquent\Collection|ApiKey[] $tokens
 * @property int|null $tokens_count
 *
 * @method ApiKey|\Laravel\Sanctum\TransientToken|null currentAccessToken() Sanctum's token model is swapped to ApiKey via Sanctum::usePersonalAccessTokenModel().
 * @method static \Database\Factories\UserFactory factory(...$parameters)
 * @method static Builder|User newModelQuery()
 * @method static Builder|User newQuery()
 * @method static Builder|User query()
 * @method static Builder|User whereCreatedAt($value)
 * @method static Builder|User whereEmail($value)
 * @method static Builder|User whereExternalId($value)
 * @method static Builder|User whereGravatar($value)
 * @method static Builder|User whereId($value)
 * @method static Builder|User whereLanguage($value)
 * @method static Builder|User whereNameFirst($value)
 * @method static Builder|User whereNameLast($value)
 * @method static Builder|User wherePassword($value)
 * @method static Builder|User whereRememberToken($value)
 * @method static Builder|User whereRootAdmin($value)
 * @method static Builder|User whereTotpAuthenticatedAt($value)
 * @method static Builder|User whereTotpSecret($value)
 * @method static Builder|User whereUpdatedAt($value)
 * @method static Builder|User whereUseTotp($value)
 * @method static Builder|User whereUsername($value)
 * @method static Builder|User whereUuid($value)
 *
 * @mixin \Barryvdh\LaravelIdeHelper\Eloquent
 * @mixin \Illuminate\Database\Query\Builder
 * @mixin \Illuminate\Database\Eloquent\Builder
 */
class User extends Model implements
    AuthenticatableContract,
    AuthorizableContract,
    CanResetPasswordContract
{
    use Authenticatable;
    use Authorizable;
    use CanResetPassword;
    use HasAccessTokens;
    use Notifiable;

    public const USER_LEVEL_USER = 0;
    public const USER_LEVEL_ADMIN = 1;

    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'user';

    /**
     * Level of servers to display when using access() on a user.
     */
    protected string $accessLevel = 'all';

    /**
     * The table associated with the model.
     */
    protected $table = 'users';

    /**
     * A list of mass-assignable variables.
     */
    protected $fillable = [
        'external_id',
        'username',
        'email',
        'stripe_id',
        'password',
        'language',
        'use_totp',
        'totp_secret',
        'admin_role_id',
        'totp_authenticated_at',
        'gravatar',
        'state',
        'root_admin',
        'recovery_code',
        'recovery_code_seen',
        'email_verified_at',
    ];

    /**
     * Transient (non-persisted) holder for a freshly generated recovery code.
     * The stored `recovery_code` column is hashed and can never be read back, so
     * the plaintext is surfaced exactly once — at generation — via this property.
     * Declared as a real property so Eloquent's magic setter never routes it into
     * the persisted attribute bag.
     */
    public ?string $recoveryCodePlain = null;

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'root_admin' => 'boolean',
        'use_totp' => 'boolean',
        'gravatar' => 'boolean',
        'recovery_code_seen' => 'boolean',
        'stripe_id' => 'string',
        'totp_authenticated_at' => 'datetime',
        'email_verified_at' => 'datetime',
    ];

    /**
     * The attributes excluded from the model's JSON form.
     */
    protected $hidden = ['password', 'recovery_code', 'remember_token', 'totp_secret', 'totp_authenticated_at'];

    /**
     * Default values for specific fields in the database.
     */
    protected $attributes = [
        'external_id' => null,
        'root_admin' => false,
        'language' => null,
        'use_totp' => false,
        'totp_secret' => null,
        'state' => null,
    ];

    /**
     * Rules verifying that the data being stored matches the expectations of the database.
     */
    public static array $validationRules = [
        'uuid' => 'required|string|size:36|unique:users,uuid',
        'email' => 'required|email|between:1,191|unique:users,email',
        'external_id' => 'sometimes|nullable|string|max:191|unique:users,external_id',
        'username' => 'required|between:1,191|unique:users,username',
        'password' => 'sometimes|nullable|string',
        'root_admin' => 'boolean',
        'language' => 'nullable|string',
        'state' => 'sometimes|nullable|string',
        'use_totp' => 'boolean',
        'admin_role_id' => 'nullable|exists:admin_roles,id',
        'totp_secret' => 'nullable|string',
        'recovery_code' => 'nullable|string',
        'recovery_code_seen' => 'sometimes|boolean',
    ];

    /**
     * Implement language verification by overriding Eloquence's gather
     * rules function.
     *
     * The panel's selectable locales live in config('app.locales') — the
     * single source of truth kept in sync with the compiled Paraglide catalog
     * (frontend/project.inlang/settings.json). The legacy getAvailableLanguages()
     * scan of resources/lang only ever knows the V1 lang folders (just "en"),
     * so it must not gate the stored preference.
     */
    public static function getRules(): array
    {
        $rules = parent::getRules();

        $rules['language'][] = new In(config('app.locales', ['en']));
        $rules['username'][] = new Username();

        return $rules;
    }

    /**
     * Return the user model in a format that can be passed over to React templates.
     */
    public function toReactObject(): array
    {
        return Collection::make($this->append(['avatar_url', 'admin_role_name', 'email_verified'])->toArray())
            ->except(['id', 'external_id', 'admin_role'])
            ->merge([
                'root_admin' => $this->isOwner(),
                'access_profile' => $this->accessProfileData(),
                'discord_linked' => !empty($this->external_id),
            ])
            ->toArray();
    }

    /**
     * Stable, non-sensitive Access Profile identity for API/bootstrap responses.
     *
     * @return array{id: int, name: string, color: string|null, is_owner: bool}|null
     */
    public function accessProfileData(): ?array
    {
        $profile = $this->adminRole;
        if (!$profile) {
            return null;
        }

        return [
            'id' => $profile->id,
            'name' => $profile->name,
            'color' => $profile->color,
            'is_owner' => $profile->isOwner(),
        ];
    }

    /**
     * Store the username as a lowercase string.
     */
    public function setUsernameAttribute(string $value)
    {
        $this->attributes['username'] = mb_strtolower($value);
    }

    public function avatarUrl(): Attribute
    {
        return Attribute::make(
            get: fn () => 'https://www.gravatar.com/avatar/' . $this->md5 . '.jpg',
        );
    }

    public function adminRoleName(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->adminRole?->name,
        );
    }

    /**
     * Deprecated compatibility field. Reads are derived from the canonical
     * Owner profile; writes persist only the temporary mirror column.
     */
    public function rootAdmin(): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value): bool => $this->isOwner(),
            set: fn (mixed $value): bool => (bool) $value,
        );
    }

    public function md5(): Attribute
    {
        return Attribute::make(
            get: fn () => md5(strtolower($this->email)),
        );
    }

    public function emailVerified(): Attribute
    {
        return Attribute::make(
            get: fn () => !is_null($this->email_verified_at),
        );
    }

    public function hasVerifiedEmail(): bool
    {
        return !is_null($this->email_verified_at);
    }

    public function markEmailAsVerified(): bool
    {
        if ($this->hasVerifiedEmail()) {
            return false;
        }

        $this->forceFill(['email_verified_at' => now()])->save();

        return true;
    }

    public function isSuspended(): bool
    {
        return $this->state === 'suspended';
    }

    /**
     * Whether this account may use an authenticated application surface.
     */
    public function isActive(): bool
    {
        return !$this->isSuspended() && !$this->isPending();
    }

    /**
     * Returns all the activity logs where this user is the subject — not to
     * be confused by activity logs where this user is the _actor_.
     */
    public function activity(): MorphToMany
    {
        return $this->morphToMany(ActivityLog::class, 'subject', 'activity_log_subjects');
    }

    public function adminRole(): BelongsTo
    {
        return $this->belongsTo(AdminRole::class, 'admin_role_id');
    }

    /**
     * Whether this account holds the protected Owner Access Profile.
     *
     * The legacy root_admin column is deliberately not consulted: it is only a
     * temporary compatibility mirror and is no longer an authorization source.
     */
    public function isOwner(): bool
    {
        return (bool) $this->adminRole?->isOwner();
    }

    public function isAdministrator(): bool
    {
        return $this->adminRole !== null;
    }

    public function apiKeys(): HasMany
    {
        return $this->hasMany(ApiKey::class)
            ->where('key_type', ApiKey::TYPE_ACCOUNT);
    }

    /** @return HasMany<ServerGroup, $this> */
    public function serverGroups(): HasMany
    {
        return $this->hasMany(ServerGroup::class);
    }

    public function recoveryTokens(): HasMany
    {
        return $this->hasMany(RecoveryToken::class);
    }

    /** @return HasMany<Server, $this> */
    public function servers(): HasMany
    {
        return $this->hasMany(Server::class, 'owner_id');
    }

    /** @return HasMany<UserSSHKey, $this> */
    public function sshKeys(): HasMany
    {
        return $this->hasMany(UserSSHKey::class);
    }

    /** @return HasMany<Ticket, $this> */
    public function tickets(): HasMany
    {
        return $this->hasMany(Ticket::class);
    }

    /** @return HasMany<UserSession, $this> */
    public function sessions(): HasMany
    {
        return $this->hasMany(UserSession::class);
    }

    /** @return HasMany<UserOAuthAccount, $this> */
    public function oauthAccounts(): HasMany
    {
        return $this->hasMany(UserOAuthAccount::class);
    }

    /**
     * Whether an SSO identity for the given provider is linked to this account.
     */
    public function hasOAuthProvider(string $provider): bool
    {
        return $this->oauthAccounts()->where('provider', $provider)->exists();
    }

    /**
     * True while jGuard is holding the account for approval. Distinct from
     * suspension — a pending account has simply never been activated.
     */
    public function isPending(): bool
    {
        return $this->state === 'pending';
    }

    public function billingProfile(): HasOne
    {
        return $this->hasOne(Billing\UserBillingProfile::class);
    }

    /**
     * Returns all the servers that a user can access by way of being the owner of the
     * server, or because they are assigned as a subuser for that server.
     */
    public function accessibleServers(): Builder
    {
        return Server::query()
            ->select('servers.*')
            ->leftJoin('subusers', 'subusers.server_id', '=', 'servers.id')
            ->where(function (Builder $builder) {
                $builder->where('servers.owner_id', $this->id)->orWhere('subusers.user_id', $this->id);
            })
            ->groupBy('servers.id');
    }
}
