<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Update existing alerts to use the old position values if needed
        // Add comment to document the new position options
        if (DB::getDriverName() !== 'sqlite') {
            DB::statement("ALTER TABLE `alerts` MODIFY COLUMN `position` VARCHAR(255) DEFAULT 'top-center' COMMENT 'top-center, slide-out, center'");
        }

        // Update any existing bottom-left or bottom-right to slide-out
        DB::table('alerts')
            ->whereIn('position', ['bottom-left', 'bottom-right'])
            ->update(['position' => 'slide-out']);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Revert slide-out back to bottom-right for backwards compatibility
        DB::table('alerts')
            ->where('position', 'slide-out')
            ->update(['position' => 'bottom-right']);
    }
};
