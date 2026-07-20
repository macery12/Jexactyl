<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('extension_file_snapshots')) {
            $hasRows = DB::table('extension_file_snapshots')->limit(1)->exists();

            if ($hasRows) {
                if (!Schema::hasTable('extension_file_snapshots_legacy')) {
                    Schema::rename('extension_file_snapshots', 'extension_file_snapshots_legacy');
                } else {
                    Schema::drop('extension_file_snapshots');
                }
            } else {
                Schema::drop('extension_file_snapshots');
            }
        }

        Schema::create('extension_file_snapshots', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id')->index();
            $table->unsignedInteger('actor_id')->nullable()->index();
            $table->string('extension_id')->index();
            $table->string('action')->index();
            $table->longText('files');
            $table->timestamps();

            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
            $table->foreign('actor_id')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('extension_file_snapshots');
    }
};
