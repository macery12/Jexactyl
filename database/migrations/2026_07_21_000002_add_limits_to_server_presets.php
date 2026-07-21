<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/**
 * Widen `server_presets` to cover the rest of a server's limits.
 *
 * A preset carried only cpu/memory/disk/nest/egg, which left the settings most
 * worth standardizing — how many databases, backups and allocations a plan
 * grants — to fall back on the create form's defaults every time. Defaults here
 * mirror the create-server form so existing presets keep behaving as they did.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('server_presets', function (Blueprint $table) {
            $table->integer('swap')->default(0)->after('disk');
            $table->unsignedInteger('io')->default(500)->after('swap');
            $table->unsignedInteger('databases')->default(0)->after('io');
            $table->unsignedInteger('backups')->default(0)->after('databases');
            $table->unsignedInteger('allocations')->default(0)->after('backups');
            $table->integer('subusers')->default(0)->after('allocations');
        });
    }

    public function down(): void
    {
        Schema::table('server_presets', function (Blueprint $table) {
            $table->dropColumn(['swap', 'io', 'databases', 'backups', 'allocations', 'subusers']);
        });
    }
};
