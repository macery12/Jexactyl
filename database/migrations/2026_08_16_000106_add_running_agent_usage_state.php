<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        $this->setStatuses(['success', 'error', 'suspended', 'running']);

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->timestamp('heartbeat_at')->nullable()->after('error_message');
            $table->timestamp('deadline_at')->nullable()->after('heartbeat_at');
            $table->index(['status', 'deadline_at'], 'ai_usage_logs_status_deadline_index');
        });
    }

    public function down(): void
    {
        DB::table('ai_usage_logs')->where('status', 'running')->update(['status' => 'error']);

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->dropIndex('ai_usage_logs_status_deadline_index');
            $table->dropColumn(['heartbeat_at', 'deadline_at']);
        });

        $this->setStatuses(['success', 'error', 'suspended']);
    }

    /** @param list<string> $statuses */
    private function setStatuses(array $statuses): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            $quoted = implode(',', array_map(fn (string $status) => "'{$status}'", $statuses));
            DB::statement("ALTER TABLE `ai_usage_logs` MODIFY `status` ENUM({$quoted}) NOT NULL DEFAULT 'success'");

            return;
        }

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->string('status', 16)->default('success')->change();
        });
    }
};
