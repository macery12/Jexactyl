<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Defensive creation/upgrade for deferred_emails queue.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('deferred_emails')) {
            Schema::create('deferred_emails', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id');
                $table->string('template_key');
                $table->string('recipient');
                $table->json('data');
                $table->string('correlation_id')->nullable();
                $table->string('reason');
                $table->timestamp('scheduled_at');
                $table->timestamp('sent_at')->nullable();
                $table->integer('attempts')->default(0);
                $table->timestamps();

                $table->index('user_id');
                $table->index('scheduled_at');
                $table->index(['user_id', 'scheduled_at']);
                $table->index('sent_at');
            });

            return;
        }

        Schema::table('deferred_emails', function (Blueprint $table) {
            if (!Schema::hasColumn('deferred_emails', 'correlation_id')) {
                $table->string('correlation_id')->nullable()->after('data');
            }
            if (!Schema::hasColumn('deferred_emails', 'reason')) {
                $table->string('reason')->after('correlation_id');
            }
            if (!Schema::hasColumn('deferred_emails', 'sent_at')) {
                $table->timestamp('sent_at')->nullable()->after('scheduled_at');
            }
            if (!Schema::hasColumn('deferred_emails', 'attempts')) {
                $table->integer('attempts')->default(0)->after('sent_at');
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('deferred_emails');
    }
};
