<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Mounts and their three pivot tables. Pivots have no primary key and use
 * CASCADE on both delete and update, matching the historical chain.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('mounts', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->string('name')->unique();
            $table->text('description')->nullable();
            $table->string('source');
            $table->string('target');
            $table->unsignedTinyInteger('read_only');
            $table->unsignedTinyInteger('user_mountable');
            $table->unique('id');
        });

        Schema::create('egg_mount', function (Blueprint $table) {
            $table->unsignedInteger('egg_id');
            $table->unsignedInteger('mount_id');

            $table->unique(['egg_id', 'mount_id']);
            $table->foreign('egg_id')->references('id')->on('eggs')->onDelete('cascade')->onUpdate('cascade');
            $table->foreign('mount_id')->references('id')->on('mounts')->onDelete('cascade')->onUpdate('cascade');
        });

        Schema::create('mount_node', function (Blueprint $table) {
            $table->unsignedInteger('node_id');
            $table->unsignedInteger('mount_id');

            $table->unique(['node_id', 'mount_id']);
            $table->foreign('node_id')->references('id')->on('nodes')->onDelete('cascade')->onUpdate('cascade');
            $table->foreign('mount_id')->references('id')->on('mounts')->onDelete('cascade')->onUpdate('cascade');
        });

        Schema::create('mount_server', function (Blueprint $table) {
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('mount_id');

            $table->unique(['server_id', 'mount_id']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade')->onUpdate('cascade');
            $table->foreign('mount_id')->references('id')->on('mounts')->onDelete('cascade')->onUpdate('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mount_server');
        Schema::dropIfExists('mount_node');
        Schema::dropIfExists('egg_mount');
        Schema::dropIfExists('mounts');
    }
};
