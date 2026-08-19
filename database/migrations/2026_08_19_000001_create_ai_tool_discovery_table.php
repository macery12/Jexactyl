<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * What the agent looked for, what it was offered, and what it could not reach.
 *
 * Separate from `ai_tool_calls` on purpose. That table answers "what did the
 * panel do, on whose behalf, and who approved it" — an audit, kept verbatim
 * because an incident review has no other source. A search is none of those
 * things: it touches nothing, changes nothing, and is interesting only in
 * aggregate. Folding the two together would put thousands of no-op rows in front
 * of the ones an investigation needs, and would quietly redefine what a row in
 * the audit means.
 *
 * The retention argument runs the same way. This is operational telemetry that
 * can be truncated whenever it stops being useful; the tool-call audit cannot.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('ai_tool_discovery', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('turn_id')->index();
            $table->unsignedBigInteger('conversation_id')->nullable()->index();
            $table->unsignedInteger('user_id')->nullable()->index();

            $table->unsignedSmallInteger('step')->default(0);
            $table->string('scope', 16);
            $table->string('phase', 24);
            $table->string('event', 24);

            // Redacted before it gets here, the same way a prompt fact is: a
            // query is user-shaped text and can carry an email address or a
            // server name that is one. Nullable because a load or an eviction has
            // no query behind it.
            $table->text('query')->nullable();

            // Names only, never schemas or results. Discovery telemetry that
            // carried tool output would be a second copy of everything the
            // privacy layer exists to keep out of storage.
            $table->json('matches')->nullable();
            $table->json('working_set')->nullable();

            $table->unsignedSmallInteger('catalogue_size')->default(0);
            $table->unsignedSmallInteger('budget')->default(0);
            $table->unsignedInteger('schema_bytes')->default(0);
            $table->string('profile', 16)->nullable();
            $table->text('reason')->nullable();

            $table->timestamp('created_at')->useCurrent();

            $table->index(['event', 'created_at']);
            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->foreign('conversation_id')->references('id')->on('ai_conversations')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_tool_discovery');
    }
};
