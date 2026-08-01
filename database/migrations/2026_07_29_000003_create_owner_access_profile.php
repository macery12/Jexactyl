<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

return new class () extends Migration {
    public function up(): void
    {
        // Validate stored data before changing the schema so a corrupt JSON
        // value cannot leave a partially applied migration on databases where
        // DDL commits independently of the surrounding transaction.
        foreach (DB::table('admin_roles')->select(['id', 'permissions'])->get() as $profile) {
            $this->decodePermissions($profile->permissions, (int) $profile->id);
        }

        if (!Schema::hasColumn('admin_roles', 'is_system')) {
            Schema::table('admin_roles', function (Blueprint $table): void {
                $table->boolean('is_system')->default(false)->after('permissions');
            });
        }
        if (!Schema::hasColumn('admin_roles', 'is_owner')) {
            Schema::table('admin_roles', function (Blueprint $table): void {
                $table->boolean('is_owner')->default(false)->after('is_system');
            });
        }
        if (!Schema::hasColumn('admin_roles', 'api_eligible')) {
            Schema::table('admin_roles', function (Blueprint $table): void {
                $table->boolean('api_eligible')->default(false)->after('is_owner');
            });
        }

        DB::transaction(function (): void {
            $registry = app(AdminCapabilityRegistry::class);
            $profiles = DB::table('admin_roles')->orderBy('id')->lockForUpdate()->get();
            $owners = $profiles->where('is_owner', true);

            if ($owners->count() > 1) {
                throw new RuntimeException('Expected at most one protected Owner access profile; found ' . $owners->count() . '.');
            }

            foreach ($profiles->where('is_owner', false) as $profile) {
                $permissions = $this->decodePermissions($profile->permissions, (int) $profile->id);
                $expanded = $this->isGeneratedKeyProfile($profile->description)
                    ? $registry->valid($permissions)
                    : $registry->valid($registry->expandLegacyProfile($permissions));
                DB::table('admin_roles')->where('id', $profile->id)->update([
                    'permissions' => json_encode($expanded, JSON_THROW_ON_ERROR),
                ]);
            }

            $owner = $owners->first();
            $ownerValues = [
                'permissions' => json_encode($registry->all(), JSON_THROW_ON_ERROR),
                'is_system' => true,
                'is_owner' => true,
                'api_eligible' => false,
            ];
            if ($owner) {
                DB::table('admin_roles')->where('id', $owner->id)->update($ownerValues);
                $ownerId = (int) $owner->id;
            } else {
                $ownerId = DB::table('admin_roles')->insertGetId(array_merge($ownerValues, [
                    'name' => 'Owner',
                    'description' => 'Built-in unrestricted human owner profile.',
                    'sort_id' => -1,
                    'color' => null,
                ]));
            }

            // The legacy flag is retained only as a response compatibility mirror.
            // Every previous root administrator now derives authority from Owner.
            DB::table('users')
                ->where('root_admin', true)
                ->update(['admin_role_id' => $ownerId]);
        });
    }

    public function down(): void
    {
        DB::transaction(function (): void {
            $ownerIds = DB::table('admin_roles')->where('is_owner', true)->pluck('id');
            if ($ownerIds->isNotEmpty()) {
                DB::table('users')
                    ->whereIn('admin_role_id', $ownerIds)
                    ->update(['root_admin' => true, 'admin_role_id' => null]);
                DB::table('admin_roles')->whereIn('id', $ownerIds)->delete();
            }
        });

        $columns = array_values(array_filter(
            ['is_system', 'is_owner', 'api_eligible'],
            static fn (string $column): bool => Schema::hasColumn('admin_roles', $column)
        ));
        if ($columns !== []) {
            Schema::table('admin_roles', function (Blueprint $table) use ($columns): void {
                $table->dropColumn($columns);
            });
        }
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
