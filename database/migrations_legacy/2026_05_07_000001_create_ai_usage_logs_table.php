<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_usage_logs', function (Blueprint $table) {
            $table->id();
            // Nullable so admin-console queries (no server context) can still be logged.
            $table->unsignedInteger('user_id')->nullable();
            $table->char('server_uuid', 36)->nullable();
            $table->unsignedBigInteger('conversation_id')->nullable();
            $table->string('model', 100);
            // 'client' = server page AI chat, 'admin' = admin console
            $table->string('source', 20)->default('client');
            $table->unsignedInteger('prompt_tokens')->nullable();
            $table->unsignedInteger('completion_tokens')->nullable();
            $table->unsignedInteger('total_tokens')->nullable();
            $table->unsignedInteger('latency_ms')->nullable();
            $table->enum('status', ['success', 'error'])->default('success');
            $table->text('error_message')->nullable();
            // No updated_at — log rows are write-once.
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('server_uuid')->references('uuid')->on('servers')->onDelete('set null');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('set null');

            $table->index('user_id');
            $table->index('server_uuid');
            $table->index('created_at'); // for date-range queries in admin dashboard
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_usage_logs');
    }
};
