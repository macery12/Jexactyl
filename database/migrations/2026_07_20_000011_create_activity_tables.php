<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Activity/audit logging. audit_logs is superseded by activity_logs but kept
 * per docs/database-rebuild/04 D2. activity_logs.server_id / api_key_id have
 * plain indexes and no FKs, matching the historical chain.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36);
            $table->boolean('is_system')->default(0);
            $table->unsignedInteger('user_id')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->string('action');
            $table->string('subaction')->nullable();
            $table->json('device');
            $table->json('metadata');
            $table->timestamp('created_at');

            $table->index(['action', 'server_id']);
            $table->index('created_at');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
        });

        Schema::create('activity_logs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('batch', 36)->nullable();
            $table->string('event')->index();
            $table->string('ip');
            $table->text('description')->nullable();
            $table->string('actor_type')->nullable();
            $table->unsignedBigInteger('actor_id')->nullable();
            $table->unsignedBigInteger('server_id')->nullable()->index();
            $table->unsignedInteger('api_key_id')->nullable();
            $table->json('properties');
            $table->timestamp('timestamp')->useCurrent();
            $table->boolean('is_admin')->default(0);
            $table->string('scope')->nullable()->index();

            $table->index(['actor_type', 'actor_id']);
            $table->index('timestamp');
        });

        Schema::create('activity_log_subjects', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('activity_log_id');
            $table->string('subject_type');
            $table->unsignedBigInteger('subject_id');

            $table->index(['subject_type', 'subject_id']);
            $table->foreign('activity_log_id')->references('id')->on('activity_logs')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_log_subjects');
        Schema::dropIfExists('activity_logs');
        Schema::dropIfExists('audit_logs');
    }
};
