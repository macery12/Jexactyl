<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class AddForeignServerVariables extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Ensure server_variables FKs match servers.id and service_variables.id
        // (INT UNSIGNED). Raw ALTER sidesteps DBAL mediumint->int mismatches on
        // MySQL/MariaDB.
        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                'ALTER TABLE `server_variables`
                    MODIFY `server_id` INT UNSIGNED NULL,
                    MODIFY `variable_id` INT UNSIGNED NOT NULL'
            );
        } else {
            Schema::table('server_variables', function (Blueprint $table) {
                $table->unsignedInteger('server_id')->nullable()->change();
                $table->unsignedInteger('variable_id')->nullable(false)->change();
            });
        }

        Schema::table('server_variables', function (Blueprint $table) {
            $table->foreign('server_id')->references('id')->on('servers');
            $table->foreign('variable_id')->references('id')->on('service_variables');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('server_variables', function (Blueprint $table) {
            $table->dropForeign(['server_id']);
            $table->dropForeign(['variable_id']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                'ALTER TABLE `server_variables`
                    MODIFY `server_id` MEDIUMINT UNSIGNED NULL,
                    MODIFY `variable_id` MEDIUMINT UNSIGNED NOT NULL'
            );
        } else {
            Schema::table('server_variables', function (Blueprint $table) {
                $table->mediumInteger('server_id', false, true)->nullable()->change();
                $table->mediumInteger('variable_id', false, true)->nullable(false)->change();
            });
        }
    }
}
