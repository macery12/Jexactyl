<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('user_sessions', function (Blueprint $table) {
            $table->string('device_label', 100)->nullable()->after('device_name');
        });
    }

    public function down(): void
    {
        Schema::table('user_sessions', function (Blueprint $table) {
            $table->dropColumn('device_label');
        });
    }
};
