<?php

namespace Everest\Services\Permission;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

class AdminPermissionService
{
    public function __construct(
        private ApplicationApiAccessProfileService $apiProfiles,
        private AdminAuthorizer $authorizer,
    ) {
    }

    /**
     * Get the permissions associated with the admin user.
     */
    public function handle(User $user): array
    {
        $permissions = [];

        $token = $user->currentAccessToken();
        if ($token instanceof ApiKey) {
            $profile = $this->apiProfiles->profileFor($token);
            $permissions[] = $profile?->permissions ?? [];

            return $permissions;
        }

        $permissions[] = $this->authorizer->capabilities($user);

        return $permissions;
    }
}
