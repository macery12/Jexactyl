<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class AddForeignServiceOptions extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Match service_options.parent_service to services.id (INT UNSIGNED);
        // raw ALTER avoids DBAL mediumint->int issues on MySQL/MariaDB.
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `service_options` MODIFY `parent_service` INT UNSIGNED NOT NULL');
        } else {
            Schema::table('service_options', function (Blueprint $table) {
                $table->unsignedInteger('parent_service')->change();
            });
        }

        Schema::table('service_options', function (Blueprint $table) {
            $table->foreign('parent_service')->references('id')->on('services');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('service_options', function (Blueprint $table) {
            $table->dropForeign(['parent_service']);
            $table->dropIndex(['parent_service']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `service_options` MODIFY `parent_service` MEDIUMINT UNSIGNED NOT NULL');
        } else {
            Schema::table('service_options', function (Blueprint $table) {
                $table->mediumInteger('parent_service', false, true)->change();
            });
        }
    }
}
