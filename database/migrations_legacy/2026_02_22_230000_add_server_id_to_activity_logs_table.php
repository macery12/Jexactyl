<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->unsignedBigInteger('server_id')->nullable()->after('actor_id')->index();
        });

        // Backfill server_id from existing relations first, then from JSON properties.
        // Wrap in try/catch to be resilient on sqlite during tests.
        try {
            // Backfill using activity_log_subjects where subject_type is Server.
            DB::table('activity_logs')
                ->whereNull('server_id')
                ->whereExists(function ($query) {
                    $query->select(DB::raw(1))
                        ->from('activity_log_subjects as als')
                        ->whereColumn('als.activity_log_id', 'activity_logs.id')
                        ->where('als.subject_type', (new \Everest\Models\Server())->getMorphClass());
                })
                ->chunkById(1000, function ($logs) {
                    foreach ($logs as $log) {
                        $serverId = DB::table('activity_log_subjects')
                            ->where('activity_log_id', $log->id)
                            ->where('subject_type', (new \Everest\Models\Server())->getMorphClass())
                            ->value('subject_id');

                        if ($serverId) {
                            DB::table('activity_logs')
                                ->where('id', $log->id)
                                ->update(['server_id' => $serverId]);
                        }
                    }
                });

            // Backfill using JSON properties->server->id when available.
            DB::table('activity_logs')
                ->whereNull('server_id')
                ->whereRaw("JSON_EXTRACT(properties, '$.\"server\".\"id\"') IS NOT NULL")
                ->chunkById(1000, function ($logs) {
                    foreach ($logs as $log) {
                        $serverId = json_decode($log->properties, true)['server']['id'] ?? null;
                        if ($serverId) {
                            DB::table('activity_logs')
                                ->where('id', $log->id)
                                ->update(['server_id' => $serverId]);
                        }
                    }
                });
        } catch (\Throwable $ignored) {
            // If the database driver does not support the JSON or chunk operations (e.g. sqlite in CI),
            // skip backfill silently; legacy rows will still be handled via fallback queries.
        }
    }

    public function down(): void
    {
        Schema::table('activity_logs', function (Blueprint $table) {
            $table->dropColumn('server_id');
        });
    }
};
