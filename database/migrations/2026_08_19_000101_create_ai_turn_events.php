<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * The durable record of what a turn emitted, in the order it emitted it.
 *
 * Until now the only trace a running turn left was the transcript, written one
 * row per completed message. That is enough to reconstruct what was *said* and
 * useless for reconstructing what is *happening*: it has no reasoning stream, no
 * pending/running tool transitions, and no cursor, so a client that lost the
 * stream could only wait for the turn to end and reload the whole thing.
 *
 * This is the other half. Every frame that goes on the wire is appended here
 * first, so reattaching is "replay from sequence N" rather than "start again".
 * `seq` is per turn and dense, which is what lets a reconnecting client say
 * exactly how much it already has without the server tracking readers.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('ai_turn_events', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->char('turn_id', 36);
            $table->unsignedInteger('seq');
            $table->string('type', 32);
            $table->json('payload')->nullable();
            $table->timestamp('created_at')->useCurrent();

            // The writer allocates `seq` itself, so this is the constraint that
            // turns "two workers ran the same turn" from silent interleaving
            // into a failure somebody can see.
            $table->unique(['turn_id', 'seq'], 'ai_turn_events_turn_seq_unique');

            // The replay query: everything for one turn after a cursor.
            $table->index(['turn_id', 'id'], 'ai_turn_events_turn_id_index');

            // Pruning walks this.
            $table->index('created_at', 'ai_turn_events_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_turn_events');
    }
};
