<?php

namespace Everest\Services\Subusers;

use Everest\Models\Server;
use Everest\Models\Subuser;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\ConnectionInterface;
use Everest\Repositories\Eloquent\SubuserRepository;
use Everest\Contracts\Repository\UserRepositoryInterface;
use Everest\Exceptions\Repository\RecordNotFoundException;
use Everest\Exceptions\Service\Subuser\UserIsServerOwnerException;
use Everest\Exceptions\Service\Subuser\ServerSubuserExistsException;

class SubuserCreationService
{
    /**
     * SubuserCreationService constructor.
     */
    public function __construct(
        private ConnectionInterface $connection,
        private SubuserRepository $subuserRepository,
        private UserRepositoryInterface $userRepository,
    ) {
    }

    /**
     * Finds an existing user by email or username and assigns them access to the provided server.
     * Users must already exist on the system - new users will not be created.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     * @throws ServerSubuserExistsException
     * @throws UserIsServerOwnerException
     * @throws RecordNotFoundException
     * @throws \Throwable
     */
    public function handle(Server $server, string $identifier, array $permissions): Subuser
    {
        return $this->connection->transaction(function () use ($server, $identifier, $permissions) {
            /** @var Server $lockedServer */
            $lockedServer = Server::query()->whereKey($server->id)->lockForUpdate()->firstOrFail();
            if (
                $lockedServer->subuser_limit > -1
                && $lockedServer->subusers()->count() >= $lockedServer->subuser_limit
            ) {
                throw new DisplayException('You cannot add any more subusers to this server.');
            }

            // Try to find user by email or username
            // If user is not found, RecordNotFoundException will be thrown
            if (filter_var($identifier, FILTER_VALIDATE_EMAIL)) {
                // Search by email
                $user = $this->userRepository->findFirstWhere([['email', '=', $identifier]]);
            } else {
                // Search by username
                $user = $this->userRepository->findFirstWhere([['username', '=', $identifier]]);
            }

            if ($lockedServer->owner_id === $user->id) {
                throw new UserIsServerOwnerException(trans('exceptions.subusers.user_is_owner'));
            }

            $subuserCount = $this->subuserRepository->findCountWhere([['user_id', '=', $user->id], ['server_id', '=', $lockedServer->id]]);
            if ($subuserCount !== 0) {
                throw new ServerSubuserExistsException(trans('exceptions.subusers.subuser_exists'));
            }

            return $this->subuserRepository->create([
                'user_id' => $user->id,
                'server_id' => $lockedServer->id,
                'permissions' => array_unique($permissions),
            ]);
        });
    }
}
