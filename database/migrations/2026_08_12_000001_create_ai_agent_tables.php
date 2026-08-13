<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Agent support: tool-call auditing, suspended turns awaiting approval, and
 * handles for operations that outlive a chat turn.
 *
 * The tool-call table is deliberately separate from activity_logs rather than
 * folded into it. Activity logs record what the *panel* did and redact console
 * command text; the agent needs a reviewable record of what the *model* asked
 * for, including arguments and the approval decision, so an operator can audit
 * an AI-driven change end to end.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('ai_messages', function (Blueprint $table) {
            // Tool calls the assistant requested on this turn, and the id a
            // tool-role message answers.
            $table->json('tool_calls')->nullable()->after('content');
            $table->string('tool_call_id', 64)->nullable()->after('tool_calls');
            $table->string('tool_name', 64)->nullable()->after('tool_call_id');
            $table->unsignedSmallInteger('step')->nullable()->after('tool_name');
        });

        // The role enum has to grow to carry tool results through the history.
        // Rebuilt rather than altered because sqlite cannot modify an enum in
        // place, and the panel supports both drivers.
        $this->widenMessageRoles();

        Schema::table('ai_usage_logs', function (Blueprint $table) {
            $table->uuid('turn_id')->nullable()->after('conversation_id');
            $table->unsignedSmallInteger('step')->nullable()->after('turn_id');
            $table->unsignedSmallInteger('tool_calls_count')->default(0)->after('step');

            // Budgets aggregate by user over a calendar month.
            $table->index(['user_id', 'created_at'], 'ai_usage_logs_user_created_index');
        });

        Schema::create('ai_tool_calls', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('turn_id')->index();
            $table->unsignedBigInteger('conversation_id')->nullable()->index();
            $table->unsignedInteger('user_id')->nullable()->index();
            $table->char('server_uuid', 36)->nullable()->index();

            $table->string('tool_name', 64);
            $table->string('risk', 16);
            $table->unsignedSmallInteger('step')->default(0);

            // Retained verbatim: an audit that omits what the model asked for
            // cannot answer the only question that matters after an incident.
            $table->json('arguments')->nullable();
            $table->text('result_summary')->nullable();

            $table->string('status', 24)->default('pending_approval');
            $table->unsignedSmallInteger('http_status')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->timestamp('resolved_at')->nullable();

            $table->index(['server_uuid', 'created_at']);
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('cascade');
        });

        Schema::create('ai_pending_actions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('turn_id')->unique();
            $table->unsignedBigInteger('conversation_id')->index();
            $table->unsignedInteger('user_id');
            $table->char('server_uuid', 36);

            $table->string('tool_name', 64);
            $table->string('risk', 16);
            $table->json('arguments');

            // The whole conversation state at the point the turn suspended. An
            // approval can arrive minutes later, long after the SSE connection
            // that produced it has closed, so the turn cannot be held in memory.
            $table->json('state');
            $table->unsignedSmallInteger('step')->default(0);

            $table->string('status', 16)->default('pending');
            $table->timestamp('expires_at')->index();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('cascade');
        });

        Schema::create('ai_operations', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('uuid')->unique();
            $table->unsignedBigInteger('conversation_id')->nullable()->index();
            $table->unsignedInteger('user_id')->nullable();
            $table->char('server_uuid', 36)->index();

            // Backups, archive extraction and restores all outlive a chat turn;
            // the handle is what lets the UI keep reporting progress after the
            // stream has closed.
            $table->string('kind', 32);
            $table->string('external_ref', 64)->nullable();
            $table->string('status', 24)->default('running');
            $table->unsignedTinyInteger('progress')->default(0);
            $table->json('payload')->nullable();
            $table->text('error')->nullable();
            $table->timestamps();
            $table->timestamp('completed_at')->nullable();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_operations');
        Schema::dropIfExists('ai_pending_actions');
        Schema::dropIfExists('ai_tool_calls');

        Schema::table('ai_usage_logs', function (Blueprint $table) {
            $table->dropIndex('ai_usage_logs_user_created_index');
            $table->dropColumn(['turn_id', 'step', 'tool_calls_count']);
        });

        Schema::table('ai_messages', function (Blueprint $table) {
            $table->dropColumn(['tool_calls', 'tool_call_id', 'tool_name', 'step']);
        });
    }

    /**
     * Widen ai_messages.role to carry system and tool turns.
     */
    private function widenMessageRoles(): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            Schema::getConnection()->statement(
                "ALTER TABLE `ai_messages` MODIFY `role` ENUM('user','assistant','system','tool') NOT NULL"
            );

            return;
        }

        // sqlite stores the enum as a check constraint that cannot be altered;
        // the column is rebuilt as a plain string instead. Validation lives in
        // the model and the request rules either way.
        Schema::table('ai_messages', function (Blueprint $table) {
            $table->string('role', 16)->default('user')->change();
        });
    }
};
