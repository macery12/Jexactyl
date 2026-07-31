<?php

namespace Everest\Services\Api;

use Everest\Models\ApiKey;
use Illuminate\Database\Connection;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

/**
 * Converts unbound historical Application API keys into immutable generated
 * profiles without increasing their effective authority.
 */
class LegacyApplicationKeyProfileMigrationService
{
    public const GENERATED_DESCRIPTION = 'System-generated migration profile for existing Application API keys.';

    public function __construct(
        private AdminCapabilityRegistry $registry,
        private ApplicationApiAccessProfileService $profiles,
    ) {
    }

    public function handle(Connection $database): void
    {
        $allCapabilities = $this->registry->all();
        $database->table('api_keys')
            ->where('key_type', ApiKey::TYPE_APPLICATION)
            ->whereNull('admin_role_id')
            ->orderBy('id')
            ->chunkById(100, function ($keys) use ($database, $allCapabilities): void {
                foreach ($keys as $key) {
                    $database->transaction(function () use ($database, $allCapabilities, $key): void {
                        $lockedKey = $database->table('api_keys')
                            ->where('id', $key->id)
                            ->whereNull('admin_role_id')
                            ->lockForUpdate()
                            ->first();
                        if (!$lockedKey) {
                            return;
                        }

                        $creator = $database->table('users')->where('id', $lockedKey->user_id)->first();
                        $creatorProfile = $creator?->admin_role_id
                            ? $database->table('admin_roles')->where('id', $creator->admin_role_id)->first()
                            : null;

                        if (!$creatorProfile) {
                            $baseCapabilities = [];
                        } elseif ((bool) $creatorProfile->is_owner) {
                            $baseCapabilities = $allCapabilities;
                        } else {
                            $stored = $this->decodePermissions(
                                $creatorProfile->permissions,
                                (int) $creatorProfile->id
                            );
                            $baseCapabilities = $this->registry->valid(
                                $this->registry->expandLegacyProfile($stored)
                            );
                        }

                        $effective = (bool) $lockedKey->acl_enforced
                            ? $this->applyLegacyMasks($lockedKey, $baseCapabilities)
                            : $baseCapabilities;
                        $effective = $this->registry->valid($effective);
                        sort($effective);

                        $profileId = $database->table('admin_roles')->insertGetId([
                            'name' => 'Migrated key ' . $lockedKey->identifier,
                            'description' => self::GENERATED_DESCRIPTION,
                            'sort_id' => 999,
                            'permissions' => json_encode($effective, JSON_THROW_ON_ERROR),
                            'color' => null,
                            'is_system' => false,
                            'is_owner' => false,
                            'api_eligible' => true,
                        ]);

                        $database->table('api_keys')->where('id', $lockedKey->id)->update([
                            'admin_role_id' => $profileId,
                            'acl_enforced' => true,
                        ]);
                    });
                }
            });
    }

    /**
     * @param list<string> $baseCapabilities
     *
     * @return list<string>
     */
    private function applyLegacyMasks(object $key, array $baseCapabilities): array
    {
        $requirements = [];
        foreach ($this->profiles->legacyCapabilityMap() as $resource => $actions) {
            foreach ($actions['read'] as $capability) {
                $requirements[$capability] = ['resource' => $resource, 'action' => AdminAcl::READ];
            }
            foreach ($actions['write'] as $capability) {
                $requirements[$capability] = ['resource' => $resource, 'action' => AdminAcl::WRITE];
            }
        }

        return array_values(array_filter(
            $baseCapabilities,
            function (string $capability) use ($requirements, $key): bool {
                $requirement = $requirements[$capability] ?? null;
                if ($requirement === null) {
                    return true;
                }

                $mask = (int) ($key->{AdminAcl::COLUMN_IDENTIFIER . $requirement['resource']} ?? AdminAcl::NONE);

                return AdminAcl::can($mask, $requirement['action']);
            }
        ));
    }

    /**
     * @return list<string>
     */
    private function decodePermissions(mixed $value, int $profileId): array
    {
        if ($value === null) {
            return [];
        }

        try {
            $permissions = json_decode((string) $value, true, flags: JSON_THROW_ON_ERROR);
        } catch (\JsonException $exception) {
            throw new \RuntimeException("Access profile {$profileId} contains malformed permission JSON.", previous: $exception);
        }

        if (
            !is_array($permissions)
            || !array_is_list($permissions)
            || array_filter($permissions, static fn (mixed $permission): bool => !is_string($permission)) !== []
        ) {
            throw new \RuntimeException("Access profile {$profileId} permissions must be a JSON list of strings.");
        }

        return $permissions;
    }
}
