<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Email notification toggles and quota tracking. Default notification-settings
 * rows are seeded by EmailNotificationSettingsSeeder (docs/database-rebuild/04
 * D4) — structure only here. email_quotas reset dates default to the migration
 * run date, same dynamic behavior as the historical chain.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_notification_settings', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('tenant_id')->nullable()->index();
            $table->string('template_key')->unique();
            $table->boolean('enabled')->default(1);
            $table->string('category')->default('general')->index();
            $table->string('name');
            $table->text('description')->nullable();
            $table->boolean('rate_limit_exempt')->default(0);
            $table->timestamps();

            $table->index(['category', 'enabled']);
        });

        $today = now()->toDateString();

        Schema::create('email_quotas', function (Blueprint $table) use ($today) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('tenant_id')->nullable()->index();
            $table->unsignedBigInteger('user_id')->unique();
            $table->string('plan')->default('free');
            $table->integer('monthly_limit')->default(3000);
            $table->integer('daily_limit')->nullable()->default(100);
            $table->integer('monthly_sent')->default(0);
            $table->integer('daily_sent')->default(0);
            $table->integer('day_sent_count')->default(0);
            $table->integer('month_sent_count')->default(0);
            $table->integer('monthly_overage')->default(0);
            $table->integer('overage_count')->default(0);
            $table->date('month_reset_at')->default($today)->index();
            $table->date('day_reset_at')->default($today)->index();
            $table->string('period_month', 7)->nullable()->index();
            $table->timestamps();

            // Historical chain carries a plain index alongside the unique — kept for fidelity.
            $table->index('user_id');
            $table->index(['user_id', 'plan']);
        });

        Schema::create('resend_quotas', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('daily_sent')->default(0);
            $table->unsignedInteger('monthly_sent')->default(0);
            $table->date('day_reset_at')->nullable();
            $table->date('month_reset_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('resend_quotas');
        Schema::dropIfExists('email_quotas');
        Schema::dropIfExists('email_notification_settings');
    }
};
