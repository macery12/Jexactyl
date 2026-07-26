<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Models\UserSession;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Services\Auth\UserSessionService;

class UserSuspensionService
{
    public function __construct(private UserSessionService $sessionService)
    {
    }

    /**
     * Suspend an account and revoke every session and API key it currently
     * owns. The administrator role assignment is intentionally preserved.
     */
    public function suspend(int|User $user): User
    {
        return $this->changeState($user, true);
    }

    /**
     * Make an account active again. Revoked sessions and deleted API keys are
     * not recreated.
     */
    public function unsuspend(int|User $user): User
    {
        return $this->changeState($user, false);
    }

    /**
     * Toggle using the state re-read under a row lock.
     */
    public function toggle(int|User $user): User
    {
        return $this->changeState($user, null);
    }

    private function changeState(int|User $user, ?bool $suspend): User
    {
        $userId = $user instanceof User ? $user->id : $user;

        [$lockedUser, $didSuspend] = DB::transaction(function () use ($userId, $suspend) {
            $lockedUser = User::query()->whereKey($userId)->lockForUpdate()->firstOrFail();
            $didSuspend = $suspend ?? !$lockedUser->isSuspended();

            if ($didSuspend && $lockedUser->root_admin) {
                throw new DisplayException('You cannot suspend a root administrator.');
            }

            $lockedUser->forceFill([
                'state' => $didSuspend ? 'suspended' : null,
            ])->save();

            if ($didSuspend) {
                UserSession::query()
                    ->where('user_id', $lockedUser->id)
                    ->update(['revoked_at' => now()]);

                // User::apiKeys() intentionally filters to account keys. A
                // suspension must revoke account and Application API keys.
                ApiKey::query()->where('user_id', $lockedUser->id)->delete();
            }

            return [$lockedUser, $didSuspend];
        });

        if ($didSuspend) {
            // The database revocation above is the authorization boundary.
            // Also destroy any backing web-session payloads after commit.
            $this->sessionService->revokeAll($lockedUser);
        }

        return $lockedUser;
    }
}
