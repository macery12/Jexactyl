<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('api_keys', function (Blueprint $table): void {
            $table->unsignedInteger('admin_role_id')->nullable()->after('user_id');
            $table->foreign('admin_role_id')
                ->references('id')
                ->on('admin_roles')
                ->restrictOnDelete();
        });

        app(LegacyApplicationKeyProfileMigrationService::class)
            ->handle(DB::connection());
    }

    public function down(): void
    {
        Schema::table('api_keys', function (Blueprint $table): void {
            $table->dropForeign(['admin_role_id']);
            $table->dropColumn('admin_role_id');
        });

        DB::table('admin_roles')
            ->where('description', LegacyApplicationKeyProfileMigrationService::GENERATED_DESCRIPTION)
            ->delete();
    }
};
