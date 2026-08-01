<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;

class UserSuspensionService
{
    public function __construct(private UserCredentialRevocationService $credentials)
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
     * Clear a pending/suspended state after jGuard has explicitly approved the
     * account. The public unsuspend API deliberately cannot approve a pending
     * account as a side effect.
     */
    public function approve(int|User $user): User
    {
        return $this->changeState($user, false, true);
    }

    /**
     * Move a pending account to suspended after jGuard explicitly rejects it.
     */
    public function reject(int|User $user): User
    {
        return $this->changeState($user, true, true);
    }

    private function changeState(int|User $user, bool $suspend, bool $allowPendingTransition = false): User
    {
        $userId = $user instanceof User ? $user->id : $user;

        [$lockedUser, $didSuspend, $pendingApprovalRequired] = DB::transaction(function () use ($userId, $suspend, $allowPendingTransition) {
            $lockedUser = User::query()->whereKey($userId)->lockForUpdate()->firstOrFail();

            if ($suspend && $lockedUser->isOwner()) {
                throw new DisplayException('You cannot suspend an Owner.');
            }

            if ($allowPendingTransition && !$lockedUser->isPending()) {
                return [$lockedUser, false, true];
            }

            if (!$allowPendingTransition && $lockedUser->isPending()) {
                return [$lockedUser, false, true];
            }

            if (!$suspend && !$lockedUser->isSuspended() && !$lockedUser->isPending()) {
                return [$lockedUser, false, false];
            }

            $lockedUser->forceFill([
                'state' => $suspend ? 'suspended' : null,
            ])->save();

            return [$lockedUser, $suspend, false];
        });

        if ($pendingApprovalRequired) {
            throw new DisplayException($allowPendingTransition ? 'Only a pending account can be approved or rejected through jGuard.' : 'A pending account must be approved or rejected through jGuard.');
        }

        if ($didSuspend) {
            $this->credentials->revokeAll($lockedUser);
        }

        return $lockedUser;
    }
}
