<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('ai_tool_calls', function (Blueprint $table) {
            $table->string('tool_call_id', 128)->nullable()->after('scope');
            $table->string('batch_parent_tool_call_id', 128)->nullable()->after('tool_call_id');
            $table->unsignedSmallInteger('batch_index')->nullable()->after('batch_parent_tool_call_id');
            $table->index(['turn_id', 'tool_call_id'], 'ai_tool_calls_turn_call_index');
        });
    }

    public function down(): void
    {
        Schema::table('ai_tool_calls', function (Blueprint $table) {
            $table->dropIndex('ai_tool_calls_turn_call_index');
            $table->dropColumn(['tool_call_id', 'batch_parent_tool_call_id', 'batch_index']);
        });
    }
};
