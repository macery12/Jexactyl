<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Defensive creation/upgrade for email_quotas.
 */
return new class extends Migration
{
    public function up(): void
    {
        $today = now()->toDateString();

        if (!Schema::hasTable('email_quotas')) {
            Schema::create('email_quotas', function (Blueprint $table) use ($today) {
                $table->id();
                $table->unsignedBigInteger('tenant_id')->nullable();
                // One quota row per user; tenant_id available for future scoping
                $table->unsignedBigInteger('user_id')->unique();
                $table->string('plan')->default('free');
                $table->integer('monthly_limit')->default(3000);
                $table->integer('daily_limit')->nullable()->default(100);
                // Legacy counters intentionally remain alongside consolidated naming (month/day_* are canonical;
                // monthly_/daily_ (monthly_sent, daily_sent, monthly_overage) slated for removal after data backfill)
                $table->integer('monthly_sent')->default(0);
                $table->integer('daily_sent')->default(0);
                $table->integer('day_sent_count')->default(0);
                $table->integer('month_sent_count')->default(0);
                $table->integer('monthly_overage')->default(0);
                $table->integer('overage_count')->default(0); // overage_count is canonical; monthly_overage kept for legacy reads
                $table->date('month_reset_at')->default($today);
                $table->date('day_reset_at')->default($today);
                $table->string('period_month', 7)->nullable();
                $table->timestamps();

                $table->index('user_id');
                $table->index(['user_id', 'plan']);
                $table->index('month_reset_at');
                $table->index('day_reset_at');
                $table->index('tenant_id');
                $table->index('period_month');
            });

            return;
        }

        Schema::table('email_quotas', function (Blueprint $table) {
            if (!Schema::hasColumn('email_quotas', 'tenant_id')) {
                $table->unsignedBigInteger('tenant_id')->nullable()->after('id');
            }
            if (!Schema::hasColumn('email_quotas', 'plan')) {
                $table->string('plan')->default('free')->after('user_id');
            }
            if (!Schema::hasColumn('email_quotas', 'monthly_limit')) {
                $table->integer('monthly_limit')->default(3000)->after('plan');
            }
            if (!Schema::hasColumn('email_quotas', 'daily_limit')) {
                $table->integer('daily_limit')->nullable()->default(100)->after('monthly_limit');
            }
            if (!Schema::hasColumn('email_quotas', 'monthly_sent')) {
                $table->integer('monthly_sent')->default(0)->after('daily_limit');
            }
            if (!Schema::hasColumn('email_quotas', 'daily_sent')) {
                $table->integer('daily_sent')->default(0)->after('monthly_sent');
            }
            if (!Schema::hasColumn('email_quotas', 'day_sent_count')) {
                $table->integer('day_sent_count')->default(0)->after('daily_sent');
            }
            if (!Schema::hasColumn('email_quotas', 'month_sent_count')) {
                $table->integer('month_sent_count')->default(0)->after('day_sent_count');
            }
            if (!Schema::hasColumn('email_quotas', 'monthly_overage')) {
                $table->integer('monthly_overage')->default(0)->after('month_sent_count');
            }
            if (!Schema::hasColumn('email_quotas', 'overage_count')) {
                $table->integer('overage_count')->default(0)->after('monthly_overage');
            }
            if (!Schema::hasColumn('email_quotas', 'month_reset_at')) {
                $table->date('month_reset_at')->nullable()->after('overage_count');
            }
            if (!Schema::hasColumn('email_quotas', 'day_reset_at')) {
                $table->date('day_reset_at')->nullable()->after('month_reset_at');
            }
            if (!Schema::hasColumn('email_quotas', 'period_month')) {
                $table->string('period_month', 7)->nullable()->after('day_reset_at');
            }
            if (!Schema::hasColumn('email_quotas', 'created_at')) {
                $table->timestamps();
            }
        });

        if (!$this->indexExists('email_quotas', 'email_quotas_tenant_id_index') && Schema::hasColumn('email_quotas', 'tenant_id')) {
            Schema::table('email_quotas', fn (Blueprint $table) => $table->index('tenant_id'));
        }
        if (!$this->indexExists('email_quotas', 'email_quotas_period_month_index') && Schema::hasColumn('email_quotas', 'period_month')) {
            Schema::table('email_quotas', fn (Blueprint $table) => $table->index('period_month'));
        }
        // Defensive in case legacy tables were created without the unique constraint
        if (!$this->indexExists('email_quotas', 'email_quotas_user_id_unique') && Schema::hasColumn('email_quotas', 'user_id')) {
            Schema::table('email_quotas', fn (Blueprint $table) => $table->unique('user_id'));
        }

        // Backfill consolidated counters from legacy columns when possible.
        if (Schema::hasColumn('email_quotas', 'monthly_sent') && Schema::hasColumn('email_quotas', 'month_sent_count')) {
            DB::statement('UPDATE email_quotas SET month_sent_count = monthly_sent WHERE month_sent_count = 0 AND monthly_sent > 0');
        }
        if (Schema::hasColumn('email_quotas', 'daily_sent') && Schema::hasColumn('email_quotas', 'day_sent_count')) {
            DB::statement('UPDATE email_quotas SET day_sent_count = daily_sent WHERE day_sent_count = 0 AND daily_sent > 0');
        }
        if (Schema::hasColumn('email_quotas', 'monthly_overage') && Schema::hasColumn('email_quotas', 'overage_count')) {
            DB::statement('UPDATE email_quotas SET overage_count = monthly_overage WHERE overage_count = 0 AND monthly_overage > 0');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('email_quotas');
    }

    private function indexExists(string $table, string $indexName): bool
    {
        try {
            $connection = Schema::getConnection();
            $schemaManager = $connection->getDoctrineSchemaManager();
            $tablePrefix = $connection->getTablePrefix();
            $indexes = $schemaManager->listTableIndexes($tablePrefix . $table);

            return array_key_exists($indexName, $indexes);
        } catch (\Throwable $e) {
            return true;
        }
    }
};
