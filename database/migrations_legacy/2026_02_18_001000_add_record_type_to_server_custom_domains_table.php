<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('server_custom_domains', function (Blueprint $table) {
            $table->enum('record_type', ['srv', 'cname'])->nullable()->after('protocol');
        });
    }

    public function down(): void
    {
        Schema::table('server_custom_domains', function (Blueprint $table) {
            $table->dropColumn('record_type');
        });
    }
};
