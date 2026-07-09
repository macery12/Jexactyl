<?php

namespace Everest\Services\Users;

use Ramsey\Uuid\Uuid;
use Everest\Models\User;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Contracts\Auth\PasswordBroker;
use Everest\Services\Billing\StripeCustomerService;
use Everest\Contracts\Repository\UserRepositoryInterface;

class UserCreationService
{
    /**
     * UserCreationService constructor.
     */
    public function __construct(
        private ConnectionInterface $connection,
        private Hasher $hasher,
        private PasswordBroker $passwordBroker,
        private UserRepositoryInterface $repository
    ) {
    }

    /**
     * Create a new user on the system.
     *
     * @throws \Exception
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    public function handle(array $data): User
    {
        if (array_key_exists('password', $data) && !empty($data['password'])) {
            $data['password'] = $this->hasher->make($data['password']);
        }

        $this->connection->beginTransaction();
        if (!isset($data['password']) || empty($data['password'])) {
            $generateResetToken = true;
            $data['password'] = $this->hasher->make(str_random(30));
        }

        // Generate the offline recovery code and store it hashed (never reversible).
        // The plaintext is surfaced exactly once, immediately after creation, via
        // the transient $user->recoveryCodePlain property below.
        $recoveryPlain = str_random(32);
        $data['recovery_code'] = $this->hasher->make($recoveryPlain);
        $data['recovery_code_seen'] = false;

        /** @var \Everest\Models\User $user */
        $user = $this->repository->create(array_merge($data, [
            'uuid' => Uuid::uuid4()->toString(),
        ]), true, true);

        $user->recoveryCodePlain = $recoveryPlain;

        if (isset($generateResetToken)) {
            $token = $this->passwordBroker->createToken($user);
        }

        $this->connection->commit();

        if (config('modules.billing.stripe.keys.secret')) {
            app(StripeCustomerService::class)->resolveForUser($user);
        }

        return $user;
    }
}
