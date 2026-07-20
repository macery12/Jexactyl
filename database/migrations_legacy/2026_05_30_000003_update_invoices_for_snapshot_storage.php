<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Step 1: rename file_* columns → data_* (JSON snapshot path, not PDF path)
        Schema::table('invoices', function (Blueprint $table) {
            $table->renameColumn('file_path', 'data_path');
            $table->renameColumn('file_disk', 'data_disk');
            $table->renameColumn('file_size_bytes', 'data_size_bytes');
        });

        // Step 2: add PDF-cache columns and drop metadata
        Schema::table('invoices', function (Blueprint $table) {
            // Local-disk ephemeral PDF cache (24-hour TTL)
            $table->string('pdf_cached_path')->nullable()->after('data_size_bytes');
            $table->timestamp('pdf_cached_at')->nullable()->after('pdf_cached_path');
            $table->timestamp('pdf_expires_at')->nullable()->after('pdf_cached_at');
            $table->index('pdf_expires_at'); // used by the hourly PDF-cache cleanup job

            // metadata held unencrypted PII — all data is now in the encrypted snapshot
            $table->dropColumn('metadata');

            // expires_at semantics change: null = data kept forever, set = auto-cleanup date
            // (old meaning was "PDF expiry date"; that is now pdf_expires_at)
            // No structural change needed — just nulling it out for existing rows below
        });

        // Clear legacy expires_at values so existing rows aren't accidentally cleaned up
        DB::table('invoices')->update(['expires_at' => null]);
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropIndex(['pdf_expires_at']);
            $table->dropColumn(['pdf_cached_path', 'pdf_cached_at', 'pdf_expires_at']);
            $table->json('metadata')->nullable();
        });

        Schema::table('invoices', function (Blueprint $table) {
            $table->renameColumn('data_path', 'file_path');
            $table->renameColumn('data_disk', 'file_disk');
            $table->renameColumn('data_size_bytes', 'file_size_bytes');
        });
    }
};
