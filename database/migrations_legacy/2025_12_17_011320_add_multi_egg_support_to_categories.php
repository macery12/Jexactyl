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
        Schema::table('categories', function (Blueprint $table) {
            // Store array of allowed egg IDs as JSON
            $table->json('allowed_eggs')->nullable()->after('egg_id');
            // Flag to control whether users can change eggs post-purchase
            $table->boolean('allow_egg_changes')->default(true)->after('allowed_eggs');
        });

        // Migrate existing single egg_id to allowed_eggs array for backward compatibility
        DB::table('categories')->get()->each(function ($category) {
            if ($category->egg_id) {
                DB::table('categories')
                    ->where('id', $category->id)
                    ->update([
                        'allowed_eggs' => json_encode([(int) $category->egg_id]),
                    ]);
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            $table->dropColumn('allowed_eggs');
            $table->dropColumn('allow_egg_changes');
        });
    }
};
