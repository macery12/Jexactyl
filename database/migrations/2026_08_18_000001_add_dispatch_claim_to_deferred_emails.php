<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Give deferred emails an atomic claim. The composite index finds claimable
 * work; the token index reads the batch back without scanning retained rows.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('deferred_emails', function (Blueprint $table): void {
            $table->uuid('claim_token')->nullable()->after('attempts');
            $table->timestamp('claimed_at')->nullable()->after('claim_token');
            $table->index(['sent_at', 'scheduled_at', 'claimed_at'], 'deferred_emails_claim_index');
            $table->index('claim_token', 'deferred_emails_claim_token_index');
        });
    }

    public function down(): void
    {
        Schema::table('deferred_emails', function (Blueprint $table): void {
            $table->dropIndex('deferred_emails_claim_index');
            $table->dropIndex('deferred_emails_claim_token_index');
            $table->dropColumn(['claim_token', 'claimed_at']);
        });
    }
};
