<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class AddForeignNodes extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Parent locations.id is INT UNSIGNED; force nodes.location to match with
        // raw ALTER to avoid DBAL mediumint->int issues on MySQL/MariaDB.
        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `nodes` MODIFY `location` INT UNSIGNED NOT NULL');
        } else {
            Schema::table('nodes', function (Blueprint $table) {
                $table->unsignedInteger('location')->nullable(false)->change();
            });
        }

        Schema::table('nodes', function (Blueprint $table) {
            $table->foreign('location')->references('id')->on('locations');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $table->dropForeign(['location']);
            $table->dropIndex(['location']);
        });

        if (DB::getDriverName() === 'mysql') {
            DB::statement('ALTER TABLE `nodes` MODIFY `location` MEDIUMINT UNSIGNED NOT NULL');
        } else {
            Schema::table('nodes', function (Blueprint $table) {
                $table->mediumInteger('location', false, true)->nullable(false)->change();
            });
        }
    }
}
