<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_conversations', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->char('server_uuid', 36);
            $table->string('title', 255)->default('New conversation');
            $table->boolean('is_saved')->default(false);
            // Null = permanently saved. Set = auto-delete after this date.
            $table->timestamp('expires_at')->nullable()->default(null);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('server_uuid')->references('uuid')->on('servers')->onDelete('cascade');
            $table->index(['user_id', 'server_uuid']);
            $table->index('expires_at'); // for efficient daily pruning
        });

        Schema::create('ai_messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('conversation_id');
            $table->enum('role', ['user', 'assistant']);
            $table->text('content');
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('cascade');
            $table->index('conversation_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_messages');
        Schema::dropIfExists('ai_conversations');
    }
};
