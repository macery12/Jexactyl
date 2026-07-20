<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('resend_quotas')) {
            return;
        }

        Schema::create('resend_quotas', function (Blueprint $table) {
            $table->id();
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
    }
};
