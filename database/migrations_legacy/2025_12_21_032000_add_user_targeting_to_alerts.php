<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Drop the table if it exists from a previous failed migration attempt
        Schema::dropIfExists('alert_user');

        Schema::create('alert_user', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('alert_id');
            $table->unsignedInteger('user_id'); // Changed from unsignedBigInteger to match users.id type
            $table->timestamps();

            $table->foreign('alert_id')->references('id')->on('alerts')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');

            $table->unique(['alert_id', 'user_id']);
        });

        // Check if the column already exists before adding it
        if (!Schema::hasColumn('alerts', 'user_targeting')) {
            Schema::table('alerts', function (Blueprint $table) {
                $table->enum('user_targeting', ['all', 'specific'])->default('all')->after('scope');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('alert_user');

        Schema::table('alerts', function (Blueprint $table) {
            $table->dropColumn('user_targeting');
        });
    }
};
