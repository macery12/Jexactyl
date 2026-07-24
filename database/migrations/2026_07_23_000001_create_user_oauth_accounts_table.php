<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Provider-agnostic storage for linked SSO identities.
 *
 * Discord previously squatted on `users.external_id`, which is a single column
 * and therefore only ever fits one provider — adding Google meant either a
 * second bespoke column or matching on email alone (which lets whoever controls
 * an address take over the account that uses it). This table keys a link on
 * (provider, provider_user_id) so a user can hold one identity per provider.
 *
 * `users.external_id` is left in place: it predates SSO and is also written by
 * external provisioning tooling. Existing Discord links are copied across so the
 * new lookup path finds them, and the column keeps working as it did.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('user_oauth_accounts', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->string('provider', 32);
            $table->string('provider_user_id');
            // Snapshot of the identity at link time, shown on the account page so
            // a user can tell which Discord/Google account is attached.
            $table->string('provider_username')->nullable();
            $table->string('provider_email')->nullable();
            $table->string('provider_avatar')->nullable();
            $table->timestamps();

            $table->unique(['provider', 'provider_user_id']);
            $table->unique(['user_id', 'provider']);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        // Backfill: every existing external_id was written by the Discord flow.
        // Rows whose external_id belongs to provisioning tooling rather than
        // Discord are harmless here — they only ever match a Discord login if the
        // id collides with a real snowflake.
        $existing = DB::table('users')
            ->whereNotNull('external_id')
            ->where('external_id', '!=', '')
            ->select('id', 'external_id', 'email')
            ->get();

        $now = now();
        $seen = [];
        foreach ($existing as $user) {
            // The unique index would reject duplicates; keep the lowest user id.
            if (isset($seen[$user->external_id])) {
                continue;
            }
            $seen[$user->external_id] = true;

            DB::table('user_oauth_accounts')->insert([
                'user_id' => $user->id,
                'provider' => 'discord',
                'provider_user_id' => $user->external_id,
                'provider_email' => $user->email,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_oauth_accounts');
    }
};
