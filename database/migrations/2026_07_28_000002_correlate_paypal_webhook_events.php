<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('paypal_webhook_events', function (Blueprint $table): void {
            // Kept independent of the local transaction FK so the verified
            // provider evidence remains useful even during reconciliation.
            $table->string('event_type')->nullable()->after('payload_hash');
            $table->string('paypal_order_id')->nullable()->after('event_type');
            $table->index('paypal_order_id', 'paypal_webhook_events_order_idx');
        });
    }

    public function down(): void
    {
        Schema::table('paypal_webhook_events', function (Blueprint $table): void {
            $table->dropIndex('paypal_webhook_events_order_idx');
            $table->dropColumn(['event_type', 'paypal_order_id']);
        });
    }
};
