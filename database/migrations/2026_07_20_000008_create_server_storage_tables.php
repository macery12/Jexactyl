<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Backups and per-server databases. The databases FKs are RESTRICT (no
 * onDelete) — deleting a server/host with rows here must fail, matching the
 * historical chain.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('backups', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('server_id');
            $table->char('uuid', 36)->unique();
            $table->boolean('is_successful')->default(0);
            $table->text('upload_id')->nullable();
            $table->unsignedTinyInteger('is_locked')->default(0);
            $table->string('name');
            $table->text('ignored_files')->nullable();
            $table->string('disk');
            $table->string('checksum')->nullable();
            $table->unsignedBigInteger('bytes')->default(0);
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
        });

        Schema::create('databases', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('database_host_id');
            $table->string('database');
            $table->string('username');
            $table->string('remote')->default('%');
            $table->text('password');
            $table->integer('max_connections')->nullable()->default(0);
            $table->timestamps();

            $table->unique(['database_host_id', 'username']);
            $table->unique(['database_host_id', 'server_id', 'database']);
            $table->foreign('server_id')->references('id')->on('servers');
            $table->foreign('database_host_id')->references('id')->on('database_hosts');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('databases');
        Schema::dropIfExists('backups');
    }
};
