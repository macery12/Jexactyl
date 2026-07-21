<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * API keys/logs and the JGuard registration-delay table. api_logs is vestigial
 * but kept per docs/database-rebuild/04 D2. The r_* permission columns sit
 * after the timestamps because that is the empirical fresh-install column order.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_keys', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->unsignedTinyInteger('key_type')->default(0);
            $table->char('identifier', 16)->nullable()->unique();
            $table->text('token');
            $table->text('allowed_ips')->nullable();
            $table->text('memo')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
            $table->unsignedTinyInteger('r_servers')->default(0);
            $table->unsignedTinyInteger('r_nodes')->default(0);
            $table->unsignedTinyInteger('r_allocations')->default(0);
            $table->unsignedTinyInteger('r_users')->default(0);
            $table->unsignedTinyInteger('r_locations')->default(0);
            $table->unsignedTinyInteger('r_nests')->default(0);
            $table->unsignedTinyInteger('r_eggs')->default(0);
            $table->unsignedTinyInteger('r_database_hosts')->default(0);
            $table->unsignedTinyInteger('r_server_databases')->default(0);

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });

        Schema::create('api_logs', function (Blueprint $table) {
            $table->increments('id');
            $table->boolean('authorized');
            $table->text('error')->nullable();
            $table->char('key', 16)->nullable();
            $table->char('method', 6);
            $table->text('route');
            $table->text('content')->nullable();
            $table->text('user_agent');
            $table->string('request_ip', 45);
            $table->timestamps();
        });

        Schema::create('jguard_delay', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->string('status', 16)->default('approved');
            $table->string('approval_mode', 16)->default('manual');
            $table->dateTime('expires_at')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('jguard_delay');
        Schema::dropIfExists('api_logs');
        Schema::dropIfExists('api_keys');
    }
};
