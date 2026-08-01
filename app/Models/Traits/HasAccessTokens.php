<?php

namespace Everest\Models\Traits;

use Everest\Models\ApiKey;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Laravel\Sanctum\HasApiTokens;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Everest\Extensions\Laravel\Sanctum\NewAccessToken;

/**
 * @mixin \Everest\Models\Model
 */
trait HasAccessTokens
{
    use HasApiTokens {
        tokens as private _tokens;
        createToken as private _createToken;
    }

    public function tokens(): HasMany
    {
        return $this->hasMany(Sanctum::$personalAccessTokenModel);
    }

    public function createToken(?string $memo, ?array $ips): NewAccessToken
    {
        return DB::transaction(function () use ($memo, $ips): NewAccessToken {
            /** @var \Everest\Models\User $owner */
            $owner = \Everest\Models\User::query()
                ->whereKey($this->getKey())
                ->lockForUpdate()
                ->firstOrFail();
            if (!$owner->isActive()) {
                throw new DisplayException('This account cannot create API keys in its current state.');
            }

            /** @var ApiKey $token */
            $token = $owner->tokens()->forceCreate([
                'user_id' => $owner->id,
                'key_type' => ApiKey::TYPE_ACCOUNT,
                'identifier' => ApiKey::generateTokenIdentifier(ApiKey::TYPE_ACCOUNT),
                'token' => encrypt($plain = Str::random(ApiKey::KEY_LENGTH)),
                'memo' => $memo ?? '',
                'allowed_ips' => $ips ?? [],
            ]);

            return new NewAccessToken($token, $plain);
        });
    }
}
