<?php

namespace Everest\Services\Users;

use Everest\Models\User;
use Illuminate\Support\Str;
use Illuminate\Contracts\Hashing\Hasher;
use Everest\Events\Email\PasswordChanged;
use Everest\Traits\Services\HasUserLevels;

class UserUpdateService
{
    use HasUserLevels;

    /**
     * UserUpdateService constructor.
     */
    public function __construct(private Hasher $hasher)
    {
    }

    /**
     * Update the user model instance and return the updated model.
     *
     * @throws \Throwable
     */
    public function handle(User $user, array $data): User
    {
        $passwordChanged = !empty(array_get($data, 'password'));

        if ($passwordChanged) {
            $data['password'] = $this->hasher->make($data['password']);
        } else {
            unset($data['password']);
        }

        // If the email address is being changed, revoke the verified status so the
        // new address must be independently verified before gated features unlock.
        if (isset($data['email']) && $data['email'] !== $user->email) {
            $data['email_verified_at'] = null;
        }

        $user->forceFill($data)->saveOrFail();

        $user = $user->refresh();

        if ($passwordChanged) {
            event(new PasswordChanged(
                user: $user,
                correlationId: Str::uuid()->toString()
            ));
        }

        return $user;
    }
}
