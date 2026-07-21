<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('ticket_messages', function (Blueprint $table) {
            if (!Schema::hasColumn('ticket_messages', 'internal_note')) {
                $table->boolean('internal_note')->default(false)->after('message');
            }
        });

        Schema::table('ticket_messages', function (Blueprint $table) {
            $existing = collect(DB::select("SHOW INDEX FROM ticket_messages WHERE Key_name = 'ticket_messages_ticket_id_internal_note_index'"));
            if ($existing->isEmpty()) {
                $table->index(['ticket_id', 'internal_note']);
            }
        });
    }

    public function down(): void
    {
        Schema::table('ticket_messages', function (Blueprint $table) {
            $existing = collect(DB::select("SHOW INDEX FROM ticket_messages WHERE Key_name = 'ticket_messages_ticket_id_internal_note_index'"));
            if ($existing->isNotEmpty()) {
                $table->dropIndex(['ticket_id', 'internal_note']);
            }

            if (Schema::hasColumn('ticket_messages', 'internal_note')) {
                $table->dropColumn('internal_note');
            }
        });
    }
};
