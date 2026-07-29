<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        Schema::table('api_keys', function (Blueprint $table): void {
            // Separates explicit scopes from legacy all-zero keys without a
            // deployment-time cutoff race.
            $table->boolean('acl_enforced')->default(false)->after('updated_at');
        });

        $columns = [
            'r_servers',
            'r_nodes',
            'r_allocations',
            'r_users',
            'r_locations',
            'r_nests',
            'r_eggs',
            'r_database_hosts',
            'r_server_databases',
        ];

        // Historical forms described value 2 as read+write even though the ACL
        // bit mask requires 3. Normalize those stored grants before restoring
        // enforcement for keys that contain an explicit non-zero scope.
        foreach ($columns as $column) {
            DB::table('api_keys')
                ->where('key_type', 2)
                ->where($column, 2)
                ->update([$column => 3]);
        }

        DB::table('api_keys')
            ->where('key_type', 2)
            ->where(function ($query) use ($columns): void {
                foreach ($columns as $column) {
                    $query->orWhere($column, '>', 0);
                }
            })
            ->update(['acl_enforced' => true]);
    }

    public function down(): void
    {
        Schema::table('api_keys', function (Blueprint $table): void {
            $table->dropColumn('acl_enforced');
        });
    }
};
