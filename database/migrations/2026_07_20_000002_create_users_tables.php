<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Users and account-security tables. admin_roles first (users.admin_role_id FK).
 * users keeps the historical Cashier-style columns (stripe_id, pm_*) — still
 * read by billing code (see docs/database-rebuild/04 D3).
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('admin_roles', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name', 64);
            $table->string('description', 255)->nullable();
            $table->integer('sort_id');
            $table->json('permissions')->nullable();
            $table->string('color')->nullable();
            $table->unique('id');
        });

        Schema::create('users', function (Blueprint $table) {
            $table->increments('id');
            $table->string('external_id')->nullable()->index();
            $table->char('uuid', 36)->unique();
            $table->string('username')->unique();
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('email_verification_token', 100)->nullable();
            $table->text('password');
            $table->string('remember_token')->nullable();
            $table->string('language', 5)->nullable();
            $table->unsignedInteger('admin_role_id')->nullable()->index();
            $table->unsignedTinyInteger('root_admin')->default(0);
            $table->unsignedTinyInteger('use_totp');
            $table->text('totp_secret')->nullable();
            $table->timestamp('totp_authenticated_at')->nullable();
            $table->boolean('gravatar')->default(1);
            $table->timestamps();
            $table->string('stripe_id')->nullable()->index();
            $table->string('pm_type')->nullable();
            $table->string('pm_last_four', 4)->nullable();
            $table->timestamp('trial_ends_at')->nullable();
            $table->string('state')->nullable();
            $table->string('recovery_code')->nullable();
            $table->boolean('recovery_code_seen')->nullable()->default(0);

            $table->foreign('admin_role_id')->references('id')->on('admin_roles')->onDelete('set null');
        });

        Schema::create('recovery_tokens', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->string('token');
            $table->timestamp('created_at')->nullable();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });

        Schema::create('user_ssh_keys', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('name');
            $table->string('fingerprint');
            $table->text('public_key');
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });

        Schema::create('user_sessions', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->string('session_id');
            $table->string('device_fingerprint');
            $table->string('device_name')->nullable();
            $table->string('device_label', 100)->nullable();
            $table->text('user_agent')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('location')->nullable();
            $table->timestamp('last_activity_at')->nullable();
            $table->timestamp('last_notified_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'session_id']);
            $table->index(['user_id', 'device_fingerprint']);
            $table->index('session_id');
            $table->index('revoked_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_sessions');
        Schema::dropIfExists('user_ssh_keys');
        Schema::dropIfExists('recovery_tokens');
        Schema::dropIfExists('users');
        Schema::dropIfExists('admin_roles');
    }
};
