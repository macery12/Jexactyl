<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;
use Everest\Services\Authorization\AdminCapabilityRegistry;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('admin_roles', function (Blueprint $table): void {
            $table->boolean('is_system')->default(false)->after('permissions');
            $table->boolean('is_owner')->default(false)->after('is_system');
            $table->boolean('api_eligible')->default(false)->after('is_owner');
        });

        DB::transaction(function (): void {
            $registry = app(AdminCapabilityRegistry::class);

            foreach (DB::table('admin_roles')->orderBy('id')->lockForUpdate()->get() as $profile) {
                $permissions = json_decode($profile->permissions ?? '[]', true);
                $expanded = is_array($permissions) ? $registry->expandLegacyProfile($permissions) : [];

                DB::table('admin_roles')->where('id', $profile->id)->update([
                    'permissions' => json_encode(array_values(array_unique($expanded))),
                ]);
            }

            $ownerId = DB::table('admin_roles')->insertGetId([
                'name' => 'Owner',
                'description' => 'Built-in unrestricted human owner profile.',
                'sort_id' => -1,
                'permissions' => json_encode($registry->all()),
                'color' => null,
                'is_system' => true,
                'is_owner' => true,
                'api_eligible' => false,
            ]);

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

        Schema::table('admin_roles', function (Blueprint $table): void {
            $table->dropColumn(['is_system', 'is_owner', 'api_eligible']);
        });
    }
};
