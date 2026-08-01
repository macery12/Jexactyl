<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;

return new class () extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('api_keys', 'admin_role_id')) {
            Schema::table('api_keys', function (Blueprint $table): void {
                $table->unsignedInteger('admin_role_id')->nullable()->after('user_id');
                $table->foreign('admin_role_id')
                    ->references('id')
                    ->on('admin_roles')
                    ->restrictOnDelete();
            });
        }

        app(LegacyApplicationKeyProfileMigrationService::class)
            ->handle(DB::connection());
    }

    public function down(): void
    {
        if (!Schema::hasColumn('api_keys', 'admin_role_id')) {
            return;
        }

        $generatedProfileIds = DB::table('api_keys')
            ->where('key_type', 2)
            ->whereNotNull('admin_role_id')
            ->pluck('admin_role_id')
            ->unique()
            ->values();

        Schema::table('api_keys', function (Blueprint $table): void {
            $table->dropForeign(['admin_role_id']);
            $table->dropColumn('admin_role_id');
        });

        DB::table('admin_roles')
            ->whereIn('id', $generatedProfileIds)
            ->where('description', LegacyApplicationKeyProfileMigrationService::GENERATED_DESCRIPTION)
            ->whereNotExists(function ($query): void {
                $query->selectRaw('1')
                    ->from('users')
                    ->whereColumn('users.admin_role_id', 'admin_roles.id');
            })
            ->delete();
    }
};
