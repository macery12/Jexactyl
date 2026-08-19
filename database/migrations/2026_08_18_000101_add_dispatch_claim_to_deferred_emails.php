<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Gives deferred emails an atomic claim.
 *
 * ProcessDeferredEmailsJob used to plain-SELECT the pending rows, dispatch a
 * SendEmailJob for each, then delete them. Two overlapping runs — the
 * every-five-minutes schedule racing itself, or a manual
 * `p:email:process-deferred` alongside cron — both read the same rows and both
 * sent. A claim token plus a lease timestamp makes the read exclusive.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('deferred_emails', function (Blueprint $table): void {
            $table->uuid('claim_token')->nullable()->after('attempts');
            $table->timestamp('claimed_at')->nullable()->after('claim_token');

            // The claim query filters on all three: unsent, due, and unclaimed
            // (or claimed long enough ago that the lease has expired).
            $table->index(['sent_at', 'scheduled_at', 'claimed_at'], 'deferred_emails_claim_index');
        });
    }

    public function down(): void
    {
        Schema::table('deferred_emails', function (Blueprint $table): void {
            $table->dropIndex('deferred_emails_claim_index');
            $table->dropColumn(['claim_token', 'claimed_at']);
        });
    }
};
