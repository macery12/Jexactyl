<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            if (!Schema::hasColumn('nodes', 'wings_type')) {
                $table->string('wings_type', 20)->default('default')->after('maintenance_mode');
            }
            if (!Schema::hasColumn('nodes', 'wings_version')) {
                $table->string('wings_version', 50)->nullable()->after('wings_type');
            }
            if (!Schema::hasColumn('nodes', 'wings_detected_at')) {
                $table->timestamp('wings_detected_at')->nullable()->after('wings_version');
            }
        });
    }

    public function down(): void
    {
        Schema::table('nodes', function (Blueprint $table) {
            $columns = [];
            if (Schema::hasColumn('nodes', 'wings_type')) {
                $columns[] = 'wings_type';
            }
            if (Schema::hasColumn('nodes', 'wings_version')) {
                $columns[] = 'wings_version';
            }
            if (Schema::hasColumn('nodes', 'wings_detected_at')) {
                $columns[] = 'wings_detected_at';
            }
            if (!empty($columns)) {
                $table->dropColumn($columns);
            }
        });
    }
};
