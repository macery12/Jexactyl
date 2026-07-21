<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI assistant tables. Conversations/logs reference servers by uuid (char 36),
 * not id. Includes the post-audit ai_usage_logs.cached column
 * (docs/database-rebuild/04 D11).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_conversations', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->char('server_uuid', 36);
            $table->string('title', 255)->default('New conversation');
            $table->boolean('is_saved')->default(0);
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();

            $table->index(['user_id', 'server_uuid']);
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('server_uuid')->references('uuid')->on('servers')->onDelete('cascade');
        });

        Schema::create('ai_messages', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('conversation_id')->index();
            $table->enum('role', ['user', 'assistant']);
            $table->text('content');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('cascade');
        });

        Schema::create('ai_usage_logs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id')->nullable()->index();
            $table->char('server_uuid', 36)->nullable()->index();
            $table->unsignedBigInteger('conversation_id')->nullable();
            $table->string('model', 100);
            $table->string('source', 20)->default('client');
            $table->unsignedInteger('prompt_tokens')->nullable();
            $table->unsignedInteger('completion_tokens')->nullable();
            $table->unsignedInteger('total_tokens')->nullable();
            $table->unsignedInteger('latency_ms')->nullable();
            $table->enum('status', ['success', 'error'])->default('success');
            $table->boolean('cached')->default(0);
            $table->text('error_message')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index('created_at');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('server_uuid')->references('uuid')->on('servers')->onDelete('set null');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage_logs');
        Schema::dropIfExists('ai_messages');
        Schema::dropIfExists('ai_conversations');
    }
};
