<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Record which tool call a suspended turn is waiting on.
 *
 * Resuming has to answer the model with a tool result carrying the *same* id
 * the model used when it asked. Without this column the id was fabricated at
 * resume time, which every provider rejects — Anthropic with "unexpected
 * tool_use_id found in tool_result blocks", OpenAI with a complaint that the
 * tool message answers no preceding tool call.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('ai_pending_actions', function (Blueprint $table) {
            // Nullable because rows suspended before this migration have no id
            // to backfill; the resume path recovers those from stored state.
            $table->string('tool_call_id', 128)->nullable()->after('tool_name');
        });
    }

    public function down(): void
    {
        Schema::table('ai_pending_actions', function (Blueprint $table) {
            $table->dropColumn('tool_call_id');
        });
    }
};
