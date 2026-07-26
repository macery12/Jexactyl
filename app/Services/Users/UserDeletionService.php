<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Support\Facades\DB;
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

        DB::transaction(function () use ($userId, $actorId) {
            // Lock every root row first so two concurrent deletions cannot both
            // conclude that another active root will remain.
            $rootUsers = User::query()
                ->where('root_admin', true)
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

            if ($target->root_admin) {
                $rootUsers->put($target->id, $target);
            }
            if ($lockedActor?->root_admin) {
                $rootUsers->put($lockedActor->id, $lockedActor);
            }

            if ($lockedActor && $lockedActor->id === $target->id) {
                throw new DisplayException('You cannot delete your own account.');
            }

            // A null actor is reserved for the trusted console command. HTTP
            // callers always pass the freshly authenticated administrator.
            if ($target->root_admin && $lockedActor && !$lockedActor->root_admin) {
                throw new DisplayException('Only an active root administrator can delete another root administrator.');
            }

            if (
                $target->root_admin
                && $target->isActive()
                && $rootUsers->filter(fn (User $root) => $root->isActive())->count() <= 1
            ) {
                throw new DisplayException('You cannot delete the final active root administrator.');
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
