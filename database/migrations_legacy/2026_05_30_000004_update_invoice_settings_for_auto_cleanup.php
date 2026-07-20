<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('invoice_settings', function (Blueprint $table) {
            // Remove time-based retention — data is kept forever by default
            $table->dropColumn('retention_days');

            // Optional auto-cleanup (default: off)
            $table->boolean('auto_cleanup_enabled')->default(false)->after('r2_bytes_limit');
            $table->unsignedSmallInteger('auto_cleanup_after_years')->default(3)->after('auto_cleanup_enabled');

            // storage_config must change from JSON → TEXT because the stored value is
            // now an AES-256 encrypted blob, not plain JSON, and MySQL rejects non-JSON
            // in a JSON column.
            $table->text('storage_config')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('invoice_settings', function (Blueprint $table) {
            $table->dropColumn(['auto_cleanup_enabled', 'auto_cleanup_after_years']);
            $table->unsignedInteger('retention_days')->default(365);
            $table->json('storage_config')->nullable()->change();
        });
    }
};
