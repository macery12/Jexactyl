<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('jguard_delay', function (Blueprint $table) {
            $table->string('status', 16)->default('approved')->after('user_id');
            $table->string('approval_mode', 16)->default('manual')->after('status');
            $table->dateTime('expires_at')->nullable()->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('jguard_delay', function (Blueprint $table) {
            $table->dropColumn(['status', 'approval_mode']);
            $table->date('expires_at')->nullable(false)->change();
        });
    }
};
