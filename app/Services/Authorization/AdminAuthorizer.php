<?php

namespace Everest\Services\Authorization;

use Everest\Models\User;
use Everest\Models\AdminRole;
use Laravel\Sanctum\TransientToken;

/**
 * Central authority for Access Profile membership and capabilities.
 */
class AdminAuthorizer
{
    public function __construct(private AdminCapabilityRegistry $capabilities)
    {
    }

    public function profile(User $user): ?AdminRole
    {
        $profile = $user->relationLoaded('adminRole')
            ? $user->getRelation('adminRole')
            : $user->adminRole()->first();

        return $profile instanceof AdminRole ? $profile : null;
    }

    public function isOwner(User $user): bool
    {
        return $this->profile($user)?->isOwner() ?? false;
    }

    /**
     * Owner-only human actions must never be inherited by an Application API
     * key whose Sanctum tokenable happens to be an Owner account.
     */
    public function isInteractiveOwner(User $user): bool
    {
        return $user->isActive()
            && $this->isOwner($user)
            && $user->currentAccessToken() instanceof TransientToken;
    }

    public function canAccessAdmin(User $user): bool
    {
        return $user->isActive() && $this->profile($user) !== null;
    }

    /**
     * @return list<string>
     */
    public function capabilities(User $user): array
    {
        $profile = $this->profile($user);
        if (!$profile) {
            return [];
        }

        return $profile->isOwner()
            ? ['*']
            : array_values(array_filter(
                $this->capabilities->normalizeMany($profile->permissions ?? []),
                fn (string $capability): bool => $this->capabilities->isValid($capability)
            ));
    }

    public function hasCapability(User $user, string $capability): bool
    {
        if (!$user->isActive()) {
            return false;
        }

        if ($this->isOwner($user)) {
            return true;
        }

        return in_array($this->capabilities->normalize($capability), $this->capabilities($user), true);
    }
}
