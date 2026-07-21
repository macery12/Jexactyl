<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AddForeignApiPermissions extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Align child key_id with api_keys.id (INT UNSIGNED). Raw ALTER avoids
        // DBAL mediumint->int quirks on MySQL/MariaDB.
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `api_permissions` MODIFY `key_id` INT UNSIGNED NOT NULL');
        } else {
            Schema::table('api_permissions', function (Blueprint $table) {
                $table->unsignedInteger('key_id')->nullable(false)->change();
            });
        }

        Schema::table('api_permissions', function (Blueprint $table) {
            $table->foreign('key_id')->references('id')->on('api_keys');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('api_permissions', function (Blueprint $table) {
            $table->dropForeign(['key_id']);
            $table->dropIndex(['key_id']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `api_permissions` MODIFY `key_id` MEDIUMINT UNSIGNED NOT NULL');
        } else {
            Schema::table('api_permissions', function (Blueprint $table) {
                $table->mediumInteger('key_id', false, true)->nullable(false)->change();
            });
        }
    }
}
