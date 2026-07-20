<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::create('server_group_members', function (Blueprint $table) {
            $table->unsignedInteger('server_id');
            $table->unsignedBigInteger('server_group_id');
            $table->primary(['server_id', 'server_group_id']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('server_group_id')->references('id')->on('server_groups')->onDelete('cascade');
        });

        // Migrate existing single-group assignments to the pivot table.
        DB::table('servers')
            ->whereNotNull('group_id')
            ->orderBy('id')
            ->get(['id', 'group_id'])
            ->each(function ($server) {
                DB::table('server_group_members')->insertOrIgnore([
                    'server_id' => $server->id,
                    'server_group_id' => $server->group_id,
                ]);
            });

        Schema::table('servers', function (Blueprint $table) {
            $table->dropColumn('group_id');
        });
    }

    public function down(): void
    {
        Schema::table('servers', function (Blueprint $table) {
            $table->unsignedInteger('group_id')->nullable();
        });

        // Restore one group per server from the pivot (take the smallest group_id).
        DB::table('server_group_members')
            ->select('server_id', DB::raw('MIN(server_group_id) as server_group_id'))
            ->groupBy('server_id')
            ->get()
            ->each(function ($row) {
                DB::table('servers')
                    ->where('id', $row->server_id)
                    ->update(['group_id' => $row->server_group_id]);
            });

        Schema::dropIfExists('server_group_members');
    }
};
