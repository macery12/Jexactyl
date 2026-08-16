<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        $this->widenUsageStatus();

        // Older agent builds appended the cumulative total after every
        // suspension leg. Keep the latest (and therefore most complete) row
        // before enforcing one row per logical turn.
        DB::table('ai_usage_logs')
            ->select('turn_id')
            ->whereNotNull('turn_id')
            ->groupBy('turn_id')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('turn_id')
            ->each(function (string $turnId): void {
                $keep = DB::table('ai_usage_logs')
                    ->where('turn_id', $turnId)
                    ->max('id');

                DB::table('ai_usage_logs')
                    ->where('turn_id', $turnId)
                    ->where('id', '<>', $keep)
                    ->delete();
            });

        Schema::table('ai_usage_logs', function (Blueprint $table) {
            $table->unique('turn_id', 'ai_usage_logs_turn_unique');
        });

        Schema::create('ai_budget_reservations', function (Blueprint $table) {
            // One live budgeted turn per user serializes admission at the
            // boundary until its actual token total has been reconciled.
            $table->unsignedInteger('user_id')->primary();
            $table->uuid('token')->unique();
            $table->timestamp('expires_at')->index();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_budget_reservations');

        Schema::table('ai_usage_logs', function (Blueprint $table) {
            $table->dropUnique('ai_usage_logs_turn_unique');
        });

        DB::table('ai_usage_logs')->where('status', 'suspended')->update(['status' => 'error']);
        $this->narrowUsageStatus();
    }

    private function widenUsageStatus(): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE `ai_usage_logs` MODIFY `status` ENUM('success','error','suspended') NOT NULL DEFAULT 'success'");

            return;
        }

        Schema::table('ai_usage_logs', function (Blueprint $table) {
            $table->string('status', 16)->default('success')->change();
        });
    }

    private function narrowUsageStatus(): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE `ai_usage_logs` MODIFY `status` ENUM('success','error') NOT NULL DEFAULT 'success'");

            return;
        }

        Schema::table('ai_usage_logs', function (Blueprint $table) {
            $table->enum('status', ['success', 'error'])->default('success')->change();
        });
    }
};
