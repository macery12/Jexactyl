<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Services\Authorization\AdminAuthorizer;

/**
 * Assign Access Profiles while preserving the legacy root_admin response mirror
 * and serializing changes that could remove the final active Owner.
 */
class UserAccessProfileService
{
    public function __construct(private AdminAuthorizer $authorizer)
    {
    }

    public function ownerProfile(): AdminRole
    {
        return AdminRole::query()->where('is_owner', true)->firstOrFail();
    }

    public function create(User $actor, array $data, UserCreationService $creation): User
    {
        return DB::transaction(function () use ($actor, $data, $creation): User {
            $owner = AdminRole::query()->where('is_owner', true)->lockForUpdate()->firstOrFail();
            $normalized = $this->normalize($data, $owner);
            $requestedProfileId = $normalized['admin_role_id'] ?? null;

            if ($requestedProfileId !== null && !$this->isInteractiveOwner($actor)) {
                throw new DisplayException('Only an active Owner can assign an Access Profile.');
            }

            return $creation->handle($normalized);
        });
    }

    public function update(User $actor, User $target, array $data, UserUpdateService $update): User
    {
        return DB::transaction(function () use ($actor, $target, $data, $update): User {
            $owner = AdminRole::query()->where('is_owner', true)->lockForUpdate()->firstOrFail();

            $ownerUsers = User::query()
                ->where('admin_role_id', $owner->id)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $lockedTarget = $ownerUsers->get($target->id)
                ?? User::query()->whereKey($target->id)->lockForUpdate()->firstOrFail();
            $normalized = $this->normalize($data, $owner, $lockedTarget);

            $currentProfileId = $lockedTarget->admin_role_id === null ? null : (int) $lockedTarget->admin_role_id;
            $requestedProfileId = array_key_exists('admin_role_id', $normalized)
                ? ($normalized['admin_role_id'] === null ? null : (int) $normalized['admin_role_id'])
                : $currentProfileId;
            $profileChanged = $requestedProfileId !== $currentProfileId;

            if ($profileChanged && !$this->isInteractiveOwner($actor)) {
                throw new DisplayException('Only an active Owner can assign an Access Profile.');
            }

            if (
                $currentProfileId === (int) $owner->id
                && $requestedProfileId !== (int) $owner->id
                && $ownerUsers
                    ->reject(static fn (User $user): bool => $user->id === $lockedTarget->id)
                    ->filter(static fn (User $user): bool => $user->isActive())
                    ->isEmpty()
            ) {
                throw new DisplayException('You cannot remove the final active Owner.');
            }

            return $update->handle($lockedTarget, $normalized);
        });
    }

    /**
     * Translate the compatibility root_admin input into the canonical profile
     * assignment and keep the legacy column synchronized for older clients.
     */
    private function normalize(array $data, AdminRole $owner, ?User $current = null): array
    {
        if (array_key_exists('root_admin', $data)) {
            if ((bool) $data['root_admin']) {
                $data['admin_role_id'] = $owner->id;
            } elseif (
                !array_key_exists('admin_role_id', $data)
                || (int) ($data['admin_role_id'] ?? 0) === (int) $owner->id
            ) {
                $data['admin_role_id'] = $current && !$current->isOwner()
                    ? $current->admin_role_id
                    : null;
            }
        }

        if (array_key_exists('admin_role_id', $data)) {
            $data['root_admin'] = (int) ($data['admin_role_id'] ?? 0) === (int) $owner->id;
        } else {
            unset($data['root_admin']);
        }

        return $data;
    }

    private function isInteractiveOwner(User $actor): bool
    {
        // Use a fresh profile while retaining the Sanctum token installed on the
        // request user; the latter distinguishes a session from an API key.
        $fresh = User::query()->with('adminRole')->findOrFail($actor->id);
        $fresh->withAccessToken($actor->currentAccessToken());

        return $this->authorizer->isInteractiveOwner($fresh);
    }
}
