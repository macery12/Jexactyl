<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('backups', function (Blueprint $table) {
            $table->unsignedBigInteger('upload_size')->nullable()->after('upload_id');
        });
    }

    public function down(): void
    {
        Schema::table('backups', function (Blueprint $table) {
            $table->dropColumn('upload_size');
        });
    }
};
