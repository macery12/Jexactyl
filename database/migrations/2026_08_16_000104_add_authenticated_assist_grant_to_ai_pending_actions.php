<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('ai_pending_actions', function (Blueprint $table): void {
            $table->json('assist_grant')->nullable()->after('state');
            $table->char('assist_grant_mac', 64)->nullable()->after('assist_grant');
        });
    }

    public function down(): void
    {
        Schema::table('ai_pending_actions', function (Blueprint $table): void {
            $table->dropColumn(['assist_grant', 'assist_grant_mac']);
        });
    }
};
