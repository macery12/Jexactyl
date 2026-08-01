<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Models\UserSession;
use Illuminate\Support\Facades\DB;
use Everest\Services\Auth\UserSessionService;

class UserCredentialRevocationService
{
    public function __construct(private UserSessionService $sessions)
    {
    }

    /**
     * Revoke every browser session and API credential owned by the user.
     *
     * The database changes are the authorization boundary and are committed
     * atomically before attempting to remove payloads from the configured
     * session handler. UserSessionService treats those external removals as
     * best-effort, so a Redis or filesystem failure cannot preserve access.
     */
    public function revokeAll(User $user): void
    {
        $lockedUser = DB::transaction(function () use ($user): User {
            $lockedUser = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            UserSession::query()
                ->where('user_id', $lockedUser->id)
                ->update(['revoked_at' => now()]);

            // User::apiKeys() intentionally includes account keys only. Query
            // the base model so Application API keys are revoked as well.
            ApiKey::query()->where('user_id', $lockedUser->id)->delete();

            return $lockedUser;
        });

        $this->sessions->revokeAll($lockedUser);
    }
}
