<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Agent-owned state in its final shape: the tool-call audit, suspended turns,
 * budget admission reservations, and durable event log.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('ai_tool_calls', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->uuid('turn_id');
            $table->unsignedBigInteger('conversation_id')->nullable()->index();
            $table->unsignedInteger('user_id')->nullable()->index();
            $table->char('server_uuid', 36)->nullable();
            $table->string('scope', 16)->default('server');
            $table->string('tool_call_id', 128)->nullable();
            $table->string('batch_parent_tool_call_id', 128)->nullable();
            $table->unsignedSmallInteger('batch_index')->nullable();
            $table->string('tool_name', 64);
            $table->string('risk', 16);
            $table->unsignedSmallInteger('step')->default(0);
            $table->json('arguments')->nullable();
            $table->text('result_summary')->nullable();
            $table->string('status', 24)->default('pending_approval');
            $table->unsignedSmallInteger('http_status')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamp('created_at', 3)->useCurrent();
            $table->timestamp('resolved_at')->nullable();

            $table->index(['turn_id', 'tool_call_id'], 'ai_tool_calls_turn_call_index');
            $table->index('created_at', 'ai_tool_calls_created_at_index');
            $table->foreign('user_id')->references('id')->on('users')->nullOnDelete();
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->nullOnDelete();
        });

        Schema::create('ai_pending_actions', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->uuid('turn_id')->unique();
            $table->unsignedBigInteger('conversation_id')->index();
            $table->unsignedInteger('user_id');
            $table->char('server_uuid', 36)->nullable();
            $table->string('scope', 16)->default('server');
            $table->string('tool_name', 64);
            $table->string('tool_call_id', 128)->nullable();
            $table->string('risk', 16);
            $table->json('arguments');
            $table->json('state');
            $table->json('assist_grant')->nullable();
            $table->char('assist_grant_mac', 64)->nullable();
            $table->unsignedSmallInteger('step')->default(0);
            $table->string('status', 16)->default('pending');
            $table->uuid('execution_key')->nullable()->unique();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->string('failure_reason', 255)->nullable();
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->index(
                ['user_id', 'status', 'expires_at'],
                'ai_pending_actions_user_status_expires_index'
            );
            $table->index(
                ['user_id', 'server_uuid', 'status'],
                'ai_pending_actions_user_server_status_index'
            );
            $table->index(['updated_at', 'status'], 'ai_pending_actions_updated_status_index');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->cascadeOnDelete();
        });

        Schema::create('ai_budget_reservations', function (Blueprint $table): void {
            $table->unsignedInteger('user_id')->primary();
            $table->uuid('token')->unique();
            $table->timestamp('expires_at');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        Schema::create('ai_turn_events', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->uuid('turn_id');
            $table->unsignedInteger('seq');
            $table->string('type', 32);
            $table->json('payload')->nullable();
            $table->timestamp('created_at', 3)->useCurrent();

            $table->unique(['turn_id', 'seq'], 'ai_turn_events_turn_seq_unique');
            $table->index('created_at', 'ai_turn_events_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_turn_events');
        Schema::dropIfExists('ai_budget_reservations');
        Schema::dropIfExists('ai_pending_actions');
        Schema::dropIfExists('ai_tool_calls');
    }
};
