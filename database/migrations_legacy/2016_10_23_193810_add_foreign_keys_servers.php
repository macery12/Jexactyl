<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class AddForeignKeysServers extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Ensure all referenced columns use the exact same type as their parents
        // before attempting to add foreign keys. Doctrine/DBAL does not always
        // detect the difference between MEDIUMINT and INT on MariaDB, so we
        // perform explicit SQL casts when running on MySQL-compatible drivers.
        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                'ALTER TABLE `servers`
                    MODIFY `node` INT UNSIGNED NOT NULL,
                    MODIFY `owner` INT UNSIGNED NOT NULL,
                    MODIFY `allocation` INT UNSIGNED NOT NULL,
                    MODIFY `service` INT UNSIGNED NOT NULL,
                    MODIFY `option` INT UNSIGNED NOT NULL'
            );
        } else {
            Schema::table('servers', function (Blueprint $table) {
                $table->unsignedInteger('node')->change();
                $table->unsignedInteger('owner')->change();
                $table->unsignedInteger('allocation')->change();
                $table->unsignedInteger('service')->change();
                $table->unsignedInteger('option')->change();
            });
        }

        Schema::table('servers', function (Blueprint $table) {
            $table->foreign('node')->references('id')->on('nodes');
            $table->foreign('owner')->references('id')->on('users');
            $table->foreign('allocation')->references('id')->on('allocations');
            $table->foreign('service')->references('id')->on('services');
            $table->foreign('option')->references('id')->on('service_options');

            $table->softDeletes();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            $table->dropForeign(['node']);
            $table->dropIndex(['node']);

            $table->dropForeign(['owner']);
            $table->dropIndex(['owner']);

            $table->dropForeign(['allocation']);
            $table->dropIndex(['allocation']);

            $table->dropForeign(['service']);
            $table->dropIndex(['service']);

            $table->dropForeign(['option']);
            $table->dropIndex(['option']);

            $table->dropColumn('deleted_at');
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                'ALTER TABLE `servers`
                    MODIFY `node` MEDIUMINT UNSIGNED NOT NULL,
                    MODIFY `owner` MEDIUMINT UNSIGNED NOT NULL,
                    MODIFY `allocation` MEDIUMINT UNSIGNED NOT NULL,
                    MODIFY `service` MEDIUMINT UNSIGNED NOT NULL,
                    MODIFY `option` MEDIUMINT UNSIGNED NOT NULL'
            );
        } else {
            Schema::table('servers', function (Blueprint $table) {
                $table->mediumInteger('node', false, true)->change();
                $table->mediumInteger('owner', false, true)->change();
                $table->mediumInteger('allocation', false, true)->change();
                $table->mediumInteger('service', false, true)->change();
                $table->mediumInteger('option', false, true)->change();
            });
        }
    }
}
