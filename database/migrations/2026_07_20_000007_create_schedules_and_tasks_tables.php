<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Scheduler subsystem (2017 refactor's final shape). tasks_log is the orphaned
 * pre-refactor log table — vestigial but kept per docs/database-rebuild/04 D2;
 * its task_id deliberately has no FK (it referenced the long-dropped tasks_old).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('schedules', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id');
            $table->string('name');
            $table->string('cron_day_of_week');
            $table->string('cron_month');
            $table->string('cron_day_of_month');
            $table->string('cron_hour');
            $table->string('cron_minute');
            $table->boolean('is_active');
            $table->boolean('is_processing');
            $table->unsignedTinyInteger('only_when_online')->default(0);
            $table->timestamp('last_run_at')->nullable();
            $table->timestamp('next_run_at')->nullable();
            $table->timestamps();

            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
        });

        Schema::create('tasks', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('schedule_id');
            $table->unsignedInteger('sequence_id');
            $table->string('action');
            $table->text('payload');
            $table->unsignedInteger('time_offset');
            $table->boolean('is_queued');
            $table->unsignedTinyInteger('continue_on_failure')->default(0);
            $table->timestamps();

            $table->index(['schedule_id', 'sequence_id']);
            $table->foreign('schedule_id')->references('id')->on('schedules')->onDelete('cascade');
        });

        Schema::create('tasks_log', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('task_id');
            $table->timestamp('run_time');
            $table->unsignedInteger('run_status');
            $table->text('response');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tasks_log');
        Schema::dropIfExists('tasks');
        Schema::dropIfExists('schedules');
    }
};
