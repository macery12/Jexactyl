<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Two columns, for two features that both turn on knowing what a value stands
 * for.
 *
 * `ai_conversations.redactions` holds the token map for a conversation: which
 * `[email_1]` stood for which address. The map has to outlive the turn that
 * minted it, because a transcript reloaded a day later still shows the tokens
 * and would otherwise be unreadable. It is not new exposure — the panel already
 * stores every one of these values in `users` — but it is a second copy, so it
 * inherits the conversation's expiry and is deleted with it.
 *
 * `tickets.server_id` records which server a ticket is about. Nothing writes it
 * yet: ticket creation does not ask, deliberately, because that is a form change
 * with its own design work. It exists now so the column is in place when it
 * does, and so the AI can read it the day it starts being filled in — the
 * fallback until then is to look up what the reporter owns.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->json('redactions')->nullable()->after('title');

            // The audited session this conversation has open on a customer's
            // server, if any. Held per conversation rather than per turn so a
            // follow-up question does not need a second approval card — the
            // access is still re-authorized on every turn and still ends when
            // the conversation does, but it is approved once, which is what an
            // administrator working a ticket actually expects.
            $table->json('assist')->nullable()->after('redactions');
        });

        Schema::table('tickets', function (Blueprint $table) {
            $table->unsignedInteger('server_id')->nullable()->after('user_id');

            // Nulled rather than cascaded: a ticket about a server that has
            // since been deleted is still a ticket, and often the interesting
            // one.
            $table->foreign('server_id')->references('id')->on('servers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table) {
            $table->dropForeign(['server_id']);
            $table->dropColumn('server_id');
        });

        Schema::table('ai_conversations', function (Blueprint $table) {
            $table->dropColumn(['redactions', 'assist']);
        });
    }
};
