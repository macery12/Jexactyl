<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\TransientToken;
use Everest\Exceptions\DisplayException;
use Illuminate\Contracts\Translation\Translator;
use Everest\Contracts\Repository\UserRepositoryInterface;

class UserDeletionService
{
    /**
     * UserDeletionService constructor.
     */
    public function __construct(
        protected UserRepositoryInterface $repository,
        protected Translator $translator,
    ) {
    }

    /**
     * Delete a user from the panel only if they have no servers attached to their account.
     *
     * @throws DisplayException
     */
    public function handle(int|User $user, ?User $actor = null): void
    {
        $userId = $user instanceof User ? $user->id : $user;
        $actorId = $actor?->id;
        $actorHasInteractiveToken = $actor?->currentAccessToken() instanceof TransientToken;

        DB::transaction(function () use ($userId, $actorId, $actorHasInteractiveToken) {
            // Lock Owner profile membership first so concurrent delete/demotion
            // operations cannot both conclude that another active Owner remains.
            $owner = AdminRole::query()
                ->where('is_owner', true)
                ->lockForUpdate()
                ->firstOrFail();
            $ownerUsers = User::query()
                ->where('admin_role_id', $owner->id)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $involvedIds = array_values(array_unique(array_filter(
                [$userId, $actorId],
                static fn (?int $id) => $id !== null
            )));

            $involvedUsers = User::query()
                ->whereIn('id', $involvedIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            /** @var User $target */
            $target = $involvedUsers->get($userId) ?? User::query()
                ->whereKey($userId)
                ->lockForUpdate()
                ->firstOrFail();

            /** @var User|null $lockedActor */
            $lockedActor = $actorId === null ? null : $involvedUsers->get($actorId);
            if ($actorId !== null && (!$lockedActor || !$lockedActor->isActive())) {
                throw new DisplayException('The acting administrator is no longer active.');
            }

            if ((int) $target->admin_role_id === (int) $owner->id) {
                $ownerUsers->put($target->id, $target);
            }
            if ((int) $lockedActor?->admin_role_id === (int) $owner->id) {
                $ownerUsers->put($lockedActor->id, $lockedActor);
            }

            if ($lockedActor && $lockedActor->id === $target->id) {
                throw new DisplayException('You cannot delete your own account.');
            }

            // A null actor is reserved for the trusted console command. HTTP
            // callers always pass the freshly authenticated administrator.
            $targetIsOwner = (int) $target->admin_role_id === (int) $owner->id;
            $actorIsInteractiveOwner = $lockedActor
                && (int) $lockedActor->admin_role_id === (int) $owner->id
                && $actorHasInteractiveToken;
            if ($targetIsOwner && $lockedActor && !$actorIsInteractiveOwner) {
                throw new DisplayException('Only an active Owner can delete another Owner.');
            }

            if (
                $targetIsOwner
                && $ownerUsers
                    ->reject(fn (User $ownerUser) => $ownerUser->id === $target->id)
                    ->filter(fn (User $ownerUser) => $ownerUser->isActive())
                    ->isEmpty()
            ) {
                throw new DisplayException('You cannot delete the final active Owner.');
            }

            $ownedServer = Server::query()
                ->withoutEagerLoads()
                ->select('id')
                ->where('owner_id', $target->id)
                ->orderBy('id')
                ->limit(1)
                ->lockForUpdate()
                ->first();
            if ($ownedServer !== null) {
                throw new DisplayException($this->translator->get('admin/user.exceptions.user_has_servers'));
            }

            $this->repository->delete($target->id);
        });
    }
}
