<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Make room for admin agent turns, which have no server.
 *
 * The AI tables were built when every conversation belonged to exactly one
 * server, so `server_uuid` is NOT NULL throughout — and on ai_conversations it
 * additionally carries a foreign key to servers.uuid. An admin turn has no
 * server at all, and without a conversation row it cannot suspend for approval
 * either, so the approval flow would simply not exist on that surface.
 *
 * A `scope` column is added alongside rather than inferring the scope from a
 * null server_uuid. The two are not the same question: a server can be deleted
 * out from under a conversation (the foreign key is ON DELETE CASCADE for
 * conversations but SET NULL for usage logs), and an orphaned server-scoped row
 * must not start reading as an admin one.
 */
return new class () extends Migration {
    public function up(): void
    {
        $this->relaxConversationServer();

        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->string('scope', 16)->default('server')->after('server_uuid');
            $table->index(['user_id', 'scope']);
        });

        Schema::table('ai_pending_actions', function (Blueprint $table) {
            $table->string('scope', 16)->default('server')->after('server_uuid');
        });

        Schema::table('ai_pending_actions', function (Blueprint $table) {
            $table->char('server_uuid', 36)->nullable()->change();
        });

        Schema::table('ai_tool_calls', function (Blueprint $table) {
            // server_uuid is already nullable here; only the discriminator is
            // missing, and the audit trail is the one place an operator most
            // needs to tell the two surfaces apart.
            $table->string('scope', 16)->default('server')->after('server_uuid');
            $table->index(['scope', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('ai_tool_calls', function (Blueprint $table) {
            $table->dropIndex(['scope', 'created_at']);
            $table->dropColumn('scope');
        });

        Schema::table('ai_pending_actions', function (Blueprint $table) {
            $table->dropColumn('scope');
        });

        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'scope']);
            $table->dropColumn('scope');
        });
    }

    /**
     * Make ai_conversations.server_uuid nullable, keeping its foreign key.
     *
     * MySQL refuses to modify a column an active foreign key depends on, so the
     * constraint is dropped and re-created around the change. sqlite has no such
     * restriction — its `change()` rebuilds the table and carries the existing
     * constraints across — and it cannot drop a named foreign key at all, so the
     * two drivers genuinely need different steps here.
     */
    private function relaxConversationServer(): void
    {
        $driver = Schema::getConnection()->getDriverName();
        $mysql = $driver === 'mysql' || $driver === 'mariadb';

        if ($mysql) {
            Schema::table('ai_conversations', function (Blueprint $table) {
                $table->dropForeign(['server_uuid']);
            });
        }

        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->char('server_uuid', 36)->nullable()->change();
        });

        if ($mysql) {
            Schema::table('ai_conversations', function (Blueprint $table) {
                $table->foreign('server_uuid')->references('uuid')->on('servers')->onDelete('cascade');
            });
        }
    }
};
