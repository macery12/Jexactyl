<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            $table->timestamp('deletion_scheduled_at')->nullable()->after('renewal_date');
            $table->unsignedBigInteger('deletion_scheduled_by')->nullable()->after('deletion_scheduled_at');
            $table->timestamp('deletion_canceled_at')->nullable()->after('deletion_scheduled_by');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            $table->dropColumn(['deletion_scheduled_at', 'deletion_scheduled_by', 'deletion_canceled_at']);
        });
    }
};
