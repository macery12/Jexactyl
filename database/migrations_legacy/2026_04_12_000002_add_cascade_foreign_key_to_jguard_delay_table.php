<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Remove orphaned entries before adding the foreign key.
        DB::table('jguard_delay')
            ->whereNotIn('user_id', DB::table('users')->select('id'))
            ->delete();

        Schema::table('jguard_delay', function (Blueprint $table) {
            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->cascadeOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('jguard_delay', function (Blueprint $table) {
            $table->dropForeign(['user_id']);
        });
    }
};
