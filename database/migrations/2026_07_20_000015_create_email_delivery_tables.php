<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Email delivery pipeline (2026-03 subsystem). email_delivery_attempts keeps
 * its near-duplicate column pairs (response_code/status_code, error_message/
 * error, raw_response/response_payload) — artifacts of two converged
 * implementations, kept per docs/database-rebuild/04 D6.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_deliveries', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('tenant_id')->nullable()->index();
            $table->char('correlation_id', 36)->nullable()->unique();
            $table->string('template_key')->nullable();
            $table->string('recipient')->index();
            $table->string('recipient_email')->nullable()->index();
            $table->unsignedInteger('user_id')->nullable();
            $table->string('subject');
            $table->string('status')->default('queued');
            $table->string('provider')->nullable()->default('resend');
            $table->string('provider_message_id')->nullable();
            $table->json('metadata')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('last_attempt_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->string('last_message_id')->nullable();
            $table->unsignedInteger('last_status_code')->nullable();
            $table->text('last_error')->nullable();
            $table->json('tags')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index(['template_key', 'created_at']);
            $table->index(['status', 'created_at']);
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
        });

        Schema::create('email_delivery_attempts', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('delivery_id');
            $table->unsignedInteger('attempt_number');
            $table->string('provider')->nullable();
            $table->string('status');
            $table->unsignedInteger('response_code')->nullable();
            $table->unsignedInteger('status_code')->nullable();
            $table->string('provider_message_id')->nullable()->index();
            $table->text('error_message')->nullable();
            $table->text('error')->nullable();
            $table->json('raw_response')->nullable();
            $table->text('response_payload')->nullable();
            $table->json('request_payload')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->boolean('success')->default(0);
            $table->string('exception_class')->nullable();
            $table->longText('stacktrace')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['delivery_id', 'attempt_number']);
            $table->foreign('delivery_id')->references('id')->on('email_deliveries')->onDelete('cascade');
        });

        Schema::create('deferred_emails', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('user_id')->index();
            $table->string('template_key');
            $table->string('recipient');
            $table->json('data');
            $table->string('correlation_id')->nullable();
            $table->string('reason');
            $table->timestamp('scheduled_at')->index();
            $table->timestamp('sent_at')->nullable()->index();
            $table->integer('attempts')->default(0);
            $table->timestamps();

            $table->index(['user_id', 'scheduled_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deferred_emails');
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');
    }
};
