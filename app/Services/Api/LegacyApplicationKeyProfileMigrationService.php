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
                    $creator = $database->table('users')->where('id', $key->user_id)->first();
                    $creatorProfile = $creator?->admin_role_id
                        ? $database->table('admin_roles')->where('id', $creator->admin_role_id)->first()
                        : null;

                    if (!$creatorProfile) {
                        $baseCapabilities = [];
                    } elseif ((bool) $creatorProfile->is_owner) {
                        $baseCapabilities = $allCapabilities;
                    } else {
                        $stored = json_decode($creatorProfile->permissions ?? '[]', true);
                        $baseCapabilities = $this->registry->normalizeMany(is_array($stored) ? $stored : []);
                    }

                    $effective = (bool) $key->acl_enforced
                        ? $this->applyLegacyMasks($key, $baseCapabilities)
                        : $baseCapabilities;
                    $effective = $this->registry->normalizeMany($effective);
                    $effective = array_values(array_filter(
                        $effective,
                        fn (string $capability): bool => $this->registry->isValid($capability)
                    ));
                    sort($effective);

                    $profileId = $database->table('admin_roles')->insertGetId([
                        'name' => 'Migrated key ' . $key->identifier,
                        'description' => self::GENERATED_DESCRIPTION,
                        'sort_id' => 999,
                        'permissions' => json_encode($effective, JSON_THROW_ON_ERROR),
                        'color' => null,
                        'is_system' => false,
                        'is_owner' => false,
                        'api_eligible' => true,
                    ]);

                    $database->table('api_keys')->where('id', $key->id)->update([
                        'admin_role_id' => $profileId,
                        'acl_enforced' => true,
                    ]);
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
}
