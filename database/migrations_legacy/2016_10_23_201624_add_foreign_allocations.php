<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class AddForeignAllocations extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // MariaDB requires child FKs to match parent INT UNSIGNED exactly; use raw
        // ALTER to avoid DBAL miscasting MEDIUMINT->INT on MySQL drivers.
        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                'ALTER TABLE `allocations`
                    MODIFY `assigned_to` INT UNSIGNED NULL,
                    MODIFY `node` INT UNSIGNED NOT NULL'
            );
        } else {
            Schema::table('allocations', function (Blueprint $table) {
                $table->unsignedInteger('assigned_to')->nullable()->change();
                $table->unsignedInteger('node')->nullable(false)->change();
            });
        }

        Schema::table('allocations', function (Blueprint $table) {
            $table->foreign('assigned_to')->references('id')->on('servers');
            $table->foreign('node')->references('id')->on('nodes');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('allocations', function (Blueprint $table) {
            $table->dropForeign(['assigned_to']);
            $table->dropIndex(['assigned_to']);

            $table->dropForeign(['node']);
            $table->dropIndex(['node']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement(
                'ALTER TABLE `allocations`
                    MODIFY `assigned_to` MEDIUMINT UNSIGNED NULL,
                    MODIFY `node` MEDIUMINT UNSIGNED NOT NULL'
            );
        } else {
            Schema::table('allocations', function (Blueprint $table) {
                $table->mediumInteger('assigned_to', false, true)->nullable()->change();
                $table->mediumInteger('node', false, true)->nullable(false)->change();
            });
        }
    }
}
