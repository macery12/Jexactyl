<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Support tickets and panel alerts. ticket_messages has no FKs (historical
 * shape). alerts.position is a varchar whose allowed values live in its column
 * comment, matching the chain (docs/database-rebuild/04 D6).
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('tickets', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('title');
            $table->string('status')->index();
            $table->enum('priority', ['low', 'medium', 'high', 'critical'])->default('medium')->index();
            $table->timestamp('last_reply_at')->nullable()->index();
            $table->unsignedInteger('user_id')->index();
            $table->unsignedInteger('assigned_to')->nullable()->index();
            $table->timestamps();

            $table->index('created_at');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('assigned_to')->references('id')->on('users')->onDelete('set null');
        });

        Schema::create('ticket_messages', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('ticket_id');
            $table->text('message');
            $table->boolean('internal_note')->default(0);
            $table->timestamps();

            $table->index(['ticket_id', 'internal_note']);
        });

        Schema::create('alerts', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('title')->nullable();
            $table->text('content');
            $table->string('type')->default('info');
            $table->string('position', 255)->nullable()->default('top-center')->comment('top-center, slide-out, center');
            $table->string('scope')->default('global');
            $table->enum('user_targeting', ['all', 'specific'])->default('all');
            $table->boolean('enabled')->default(1);
            $table->boolean('dismissible')->default(0);
            $table->boolean('show_button')->default(0);
            $table->string('button_text')->nullable();
            $table->string('button_position')->default('bottom-right');
            $table->string('link')->nullable();
            $table->string('link_text')->nullable();
            $table->integer('priority')->default(0);
            $table->timestamp('start_at')->nullable();
            $table->timestamp('end_at')->nullable();
            $table->timestamps();
        });

        Schema::create('alert_user', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('alert_id');
            $table->unsignedInteger('user_id');
            $table->timestamps();

            $table->unique(['alert_id', 'user_id']);
            $table->foreign('alert_id')->references('id')->on('alerts')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('alert_user');
        Schema::dropIfExists('alerts');
        Schema::dropIfExists('ticket_messages');
        Schema::dropIfExists('tickets');
    }
};
