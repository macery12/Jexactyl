<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('activity_logs', 'scope')) {
            Schema::table('activity_logs', function (Blueprint $table) {
                $table->string('scope')->nullable()->after('is_admin')->index();
            });
        }

        try {
            DB::table('activity_logs')
                ->whereNull('scope')
                ->orderBy('id')
                ->chunkById(500, function ($logs) {
                    foreach ($logs as $log) {
                        $properties = json_decode($log->properties ?: '{}', true) ?: [];

                        $context = $log->is_admin ? 'admin' : 'client';
                        if (!isset($properties['context'])) {
                            $properties['context'] = $context;
                        }

                        $scope = $log->server_id ? 'server' : ($log->is_admin ? 'admin' : 'account');

                        DB::table('activity_logs')
                            ->where('id', $log->id)
                            ->update([
                                'scope' => $scope,
                                'properties' => json_encode($properties),
                            ]);
                    }
                });
        } catch (\Throwable $ignored) {
            // Be defensive for drivers without JSON/chunk support (e.g. sqlite in tests).
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('activity_logs', 'scope')) {
            Schema::table('activity_logs', function (Blueprint $table) {
                $table->dropColumn('scope');
            });
        }
    }
};
