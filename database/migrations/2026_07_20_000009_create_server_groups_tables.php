<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * User-defined server groups (dashboard organization) and admin server presets.
 * server_groups.user_id has no FK in the historical chain — reproduced as-is.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('server_groups', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id');
            $table->string('name');
            $table->string('color')->nullable();
            $table->timestamps();
        });

        Schema::create('server_group_members', function (Blueprint $table) {
            $table->unsignedInteger('server_id');
            $table->unsignedBigInteger('server_group_id');

            $table->primary(['server_id', 'server_group_id']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('server_group_id')->references('id')->on('server_groups')->onDelete('cascade');
        });

        Schema::create('server_presets', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36)->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedInteger('cpu');
            $table->integer('memory');
            $table->integer('disk');
            $table->unsignedInteger('nest_id')->nullable();
            $table->unsignedInteger('egg_id')->nullable();
            $table->timestamps();

            $table->foreign('nest_id')->references('id')->on('nests')->onDelete('set null');
            $table->foreign('egg_id')->references('id')->on('eggs')->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('server_presets');
        Schema::dropIfExists('server_group_members');
        Schema::dropIfExists('server_groups');
    }
};
