<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Database\Migrations\Migration;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

return new class () extends Migration {
    public function up(): void
    {
        DB::transaction(function (): void {
            $registry = app(AdminCapabilityRegistry::class);
            $profiles = DB::table('admin_roles')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();
            $owners = $profiles->where('is_owner', true);

            if ($owners->count() !== 1) {
                throw new RuntimeException('Expected exactly one protected Owner access profile; found ' . $owners->count() . '.');
            }

            foreach ($profiles as $profile) {
                $permissions = $this->decodePermissions($profile->permissions, (int) $profile->id);
                $canonical = (bool) $profile->is_owner
                    ? $registry->all()
                    : ($this->isGeneratedKeyProfile($profile->description)
                        ? $registry->valid($permissions)
                        : $registry->valid($registry->expandLegacyProfile($permissions)));

                DB::table('admin_roles')->where('id', $profile->id)->update([
                    'permissions' => json_encode($canonical, JSON_THROW_ON_ERROR),
                    'is_system' => (bool) $profile->is_owner ? true : (bool) $profile->is_system,
                    'api_eligible' => (bool) $profile->is_owner ? false : (bool) $profile->api_eligible,
                ]);
            }
        });
    }

    public function down(): void
    {
        // Canonicalization only removes invalid, non-authorizing identifiers.
        // Their original spelling cannot be reconstructed safely.
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
        } catch (JsonException $exception) {
            throw new RuntimeException("Access profile {$profileId} contains malformed permission JSON.", previous: $exception);
        }

        if (
            !is_array($permissions)
            || !array_is_list($permissions)
            || array_filter($permissions, static fn (mixed $permission): bool => !is_string($permission)) !== []
        ) {
            throw new RuntimeException("Access profile {$profileId} permissions must be a JSON list of strings.");
        }

        return $permissions;
    }

    private function isGeneratedKeyProfile(?string $description): bool
    {
        return in_array($description, [
            LegacyApplicationKeyProfileMigrationService::GENERATED_DESCRIPTION,
            ApplicationApiAccessProfileService::LEGACY_CREATE_DESCRIPTION,
        ], true);
    }
};
