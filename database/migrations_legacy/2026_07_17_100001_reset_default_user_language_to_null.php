<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    /**
     * The users.language column is already nullable, but every existing row holds
     * the model's old 'en' default — no per-user language picker ever existed, so
     * none of these values are a user's actual choice. Null them out so everyone
     * follows the panel-wide default until they explicitly pick a language.
     */
    public function up(): void
    {
        DB::table('users')->update(['language' => null]);
    }

    public function down(): void
    {
        DB::table('users')->whereNull('language')->update(['language' => 'en']);
    }
};
