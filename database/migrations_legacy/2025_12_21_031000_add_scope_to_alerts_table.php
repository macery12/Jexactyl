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
        Schema::table('alerts', function (Blueprint $table) {
            $table->string('scope')->default('global')->after('position');
            // Scopes: global, dashboard, server, billing, account, admin
            $table->boolean('show_button')->default(false)->after('dismissible');
            // Whether to show a floating button to reopen dismissed popup alerts
            $table->string('button_text')->nullable()->after('show_button');
            $table->string('button_position')->default('bottom-right')->after('button_text');
            // Button positions: bottom-right, bottom-left, top-right, top-left
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('alerts', function (Blueprint $table) {
            $table->dropColumn(['scope', 'show_button', 'button_text', 'button_position']);
        });
    }
};
