<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * A user-initiated stop, recorded durably rather than inferred from a closed
 * socket.
 *
 * Until now `cancelled` existed only in the browser: pressing Stop aborted the
 * fetch and nothing else. The turn carried on spending budget and running tools
 * against a reader that had gone. `cancel_requested_at` is the request, and the
 * `cancelled` status is the outcome — two columns because a turn that is asked
 * to stop mid-tool does not stop at that instant, and the gap between asking
 * and stopping is exactly the thing an operator needs to be able to read.
 */
return new class () extends Migration {
    public function up(): void
    {
        $this->setStatuses(['success', 'error', 'suspended', 'running', 'cancelled']);

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->timestamp('cancel_requested_at')->nullable()->after('deadline_at');
        });
    }

    public function down(): void
    {
        // A cancelled turn is a finished turn that did not produce an answer.
        // `error` is the closest thing the narrower vocabulary can say about it.
        DB::table('ai_usage_logs')->where('status', 'cancelled')->update(['status' => 'error']);

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->dropColumn('cancel_requested_at');
        });

        $this->setStatuses(['success', 'error', 'suspended', 'running']);
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
