<?php

namespace Everest\Services\Authorization;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Illuminate\Support\Str;
use Everest\Models\AdminRole;
use Laravel\Sanctum\TransientToken;
use Everest\Services\Acl\Api\AdminAcl;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Resolves the authority of Application API service credentials.
 *
 * ApiKey::user_id remains the Sanctum tokenable and audit creator. It is
 * deliberately not consulted for authorization: a bound API-eligible profile
 * is the service identity's sole runtime authority.
 */
class ApplicationApiAccessProfileService
{
    public function __construct(private AdminCapabilityRegistry $capabilities)
    {
    }

    public function profileFor(ApiKey $key): ?AdminRole
    {
        if ($key->key_type !== ApiKey::TYPE_APPLICATION || $key->admin_role_id === null) {
            return null;
        }

        $profile = $key->relationLoaded('accessProfile')
            ? $key->accessProfile
            : $key->accessProfile()->first();

        return $profile instanceof AdminRole && $this->capabilities->isApiEligible($profile)
            ? $profile
            : null;
    }

    public function allows(ApiKey $key, string $capability): bool
    {
        $profile = $this->profileFor($key);
        if (!$profile || !$this->capabilities->isValid($capability)) {
            return false;
        }

        return in_array(
            $this->capabilities->normalize($capability),
            $this->profileCapabilities($profile),
            true
        );
    }

    /**
     * Return the effective capabilities of the requesting principal. Sessions
     * use their human Access Profile; Application keys use only the key-bound
     * profile and never inherit the creator's current authority.
     *
     * @return list<string>
     */
    public function principalCapabilities(User $actor): array
    {
        $token = $actor->currentAccessToken();
        if ($token instanceof ApiKey) {
            $profile = $this->profileFor($token);

            return $profile ? $this->profileCapabilities($profile) : [];
        }

        if (!$token instanceof TransientToken) {
            return [];
        }

        $profile = $actor->adminRole;
        if (!$profile) {
            return [];
        }

        return $profile->is_owner
            ? $this->capabilities->all()
            : $this->profileCapabilities($profile);
    }

    public function canDelegate(User $actor, AdminRole $profile): bool
    {
        if (!$this->capabilities->isApiEligible($profile) || $profile->is_owner) {
            return false;
        }

        $token = $actor->currentAccessToken();
        if ($token instanceof TransientToken && $actor->adminRole?->is_owner) {
            return true;
        }

        return array_diff(
            $this->profileCapabilities($profile),
            $this->principalCapabilities($actor)
        ) === [];
    }

    public function assertCanDelegate(User $actor, AdminRole $profile): void
    {
        if (!$this->canDelegate($actor, $profile)) {
            throw new AccessDeniedHttpException('The selected access profile is not API-eligible or exceeds this principal\'s authority.');
        }
    }

    /**
     * @return list<AdminRole>
     */
    public function delegableProfiles(User $actor): array
    {
        return AdminRole::query()
            ->where('api_eligible', true)
            ->where('is_owner', false)
            ->orderBy('sort_id')
            ->orderBy('name')
            ->get()
            ->filter(fn (AdminRole $profile): bool => $this->canDelegate($actor, $profile))
            ->values()
            ->all();
    }

    /**
     * Compatibility bridge for the historical nine-resource create contract.
     * The generated profile contains only capabilities represented by those
     * masks and is intersected with the calling principal's current authority.
     *
     * @param array<string, int> $permissions
     */
    public function createLegacyProfile(User $actor, array $permissions): AdminRole
    {
        $requested = [];
        foreach ($this->legacyCapabilityMap() as $resource => $mapping) {
            $mask = (int) ($permissions[AdminAcl::COLUMN_IDENTIFIER . $resource] ?? AdminAcl::NONE);
            if (AdminAcl::can($mask, AdminAcl::READ)) {
                array_push($requested, ...$mapping['read']);
            }
            if (AdminAcl::can($mask, AdminAcl::WRITE)) {
                array_push($requested, ...$mapping['write']);
            }
        }

        $requested = $this->capabilities->normalizeMany($requested);
        $effective = array_values(array_intersect($requested, $this->principalCapabilities($actor)));
        sort($effective);

        return AdminRole::query()->forceCreate([
            'name' => 'Legacy API key ' . Str::upper(Str::random(12)),
            'description' => 'System-generated profile for a legacy resource-scope API key.',
            'sort_id' => 999,
            'permissions' => $effective,
            'color' => null,
            'is_system' => false,
            'is_owner' => false,
            'api_eligible' => true,
        ]);
    }

    /**
     * @return list<string>
     */
    private function profileCapabilities(AdminRole $profile): array
    {
        return array_values(array_filter(
            $this->capabilities->normalizeMany($profile->permissions ?? []),
            fn (string $capability): bool => $this->capabilities->isValid($capability)
        ));
    }

    /**
     * @return array<string, array{read: list<string>, write: list<string>}>
     */
    public function legacyCapabilityMap(): array
    {
        return [
            AdminAcl::RESOURCE_SERVERS => [
                'read' => [AdminRole::SERVERS_READ],
                'write' => [AdminRole::SERVERS_CREATE, AdminRole::SERVERS_UPDATE, AdminRole::SERVERS_DELETE],
            ],
            AdminAcl::RESOURCE_NODES => [
                'read' => [AdminRole::NODES_READ],
                'write' => [AdminRole::NODES_CREATE, AdminRole::NODES_UPDATE, AdminRole::NODES_DELETE],
            ],
            AdminAcl::RESOURCE_ALLOCATIONS => [
                'read' => [AdminRole::ALLOCATIONS_READ],
                'write' => [AdminRole::ALLOCATIONS_CREATE, AdminRole::ALLOCATIONS_DELETE],
            ],
            AdminAcl::RESOURCE_USERS => [
                'read' => [AdminRole::USERS_READ],
                'write' => [AdminRole::USERS_CREATE, AdminRole::USERS_UPDATE, AdminRole::USERS_DELETE],
            ],
            AdminAcl::RESOURCE_LOCATIONS => [
                'read' => [AdminRole::LOCATIONS_READ],
                'write' => [AdminRole::LOCATIONS_UPDATE],
            ],
            AdminAcl::RESOURCE_NESTS => [
                'read' => [AdminRole::NESTS_READ],
                'write' => [AdminRole::NESTS_CREATE, AdminRole::NESTS_UPDATE, AdminRole::NESTS_DELETE],
            ],
            AdminAcl::RESOURCE_EGGS => [
                'read' => [AdminRole::EGGS_READ, AdminRole::EGGS_EXPORT],
                'write' => [AdminRole::EGGS_CREATE, AdminRole::EGGS_UPDATE, AdminRole::EGGS_DELETE, AdminRole::EGGS_IMPORT],
            ],
            AdminAcl::RESOURCE_DATABASE_HOSTS => [
                'read' => [AdminRole::DATABASES_READ],
                'write' => [AdminRole::DATABASES_CREATE, AdminRole::DATABASES_UPDATE, AdminRole::DATABASES_DELETE],
            ],
            AdminAcl::RESOURCE_SERVER_DATABASES => [
                'read' => [AdminRole::SERVER_DATABASES_READ],
                'write' => [
                    AdminRole::SERVER_DATABASES_CREATE,
                    AdminRole::SERVER_DATABASES_UPDATE,
                    AdminRole::SERVER_DATABASES_DELETE,
                ],
            ],
        ];
    }
}
