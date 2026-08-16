<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ai_pending_actions', function (Blueprint $table): void {
            $table->uuid('execution_key')->nullable()->unique()->after('status');
            $table->timestamp('claimed_at')->nullable()->index()->after('execution_key');
            $table->timestamp('resolved_at')->nullable()->after('claimed_at');
            $table->string('failure_reason', 255)->nullable()->after('resolved_at');
        });
    }

    public function down(): void
    {
        Schema::table('ai_pending_actions', function (Blueprint $table): void {
            $table->dropUnique(['execution_key']);
            $table->dropIndex(['claimed_at']);
            $table->dropColumn(['execution_key', 'claimed_at', 'resolved_at', 'failure_reason']);
        });
    }
};
