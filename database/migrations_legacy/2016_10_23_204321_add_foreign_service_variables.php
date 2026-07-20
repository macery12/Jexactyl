<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class AddForeignServiceVariables extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Align option_id to service_options.id (INT UNSIGNED); raw ALTER avoids
        // DBAL mediumint->int inconsistencies on MySQL/MariaDB.
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `service_variables` MODIFY `option_id` INT UNSIGNED NOT NULL');
        } else {
            Schema::table('service_variables', function (Blueprint $table) {
                $table->unsignedInteger('option_id')->change();
            });
        }

        Schema::table('service_variables', function (Blueprint $table) {
            $table->foreign('option_id')->references('id')->on('service_options');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('service_variables', function (Blueprint $table) {
            $table->dropForeign(['option_id']);
            $table->dropIndex(['option_id']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `service_variables` MODIFY `option_id` MEDIUMINT UNSIGNED NOT NULL');
        } else {
            Schema::table('service_variables', function (Blueprint $table) {
                $table->mediumInteger('option_id', false, true)->change();
            });
        }
    }
}
