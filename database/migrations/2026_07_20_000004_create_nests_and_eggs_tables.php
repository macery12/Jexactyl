<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Nests, eggs and egg variables (final shape of the services → nests /
 * service_options → eggs lineage). eggs has two self-referencing FKs
 * (config_from, copy_script_from).
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('nests', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->string('author');
            $table->string('name');
            $table->text('description')->nullable();
            $table->timestamps();
        });

        Schema::create('eggs', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('nest_id')->index();
            $table->string('author');
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('features')->nullable();
            $table->json('docker_images')->nullable();
            $table->json('file_denylist')->nullable();
            $table->text('update_url')->nullable();
            $table->text('config_files')->nullable();
            $table->text('config_startup')->nullable();
            $table->string('config_stop')->nullable();
            $table->unsignedInteger('config_from')->nullable();
            $table->text('startup')->nullable();
            $table->string('script_container')->default('ghcr.io/pterodactyl/installers:alpine');
            $table->unsignedInteger('copy_script_from')->nullable();
            $table->string('script_entry')->default('/bin/ash');
            $table->boolean('script_is_privileged')->default(1);
            $table->text('script_install')->nullable();
            $table->timestamps();
            $table->boolean('force_outgoing_ip')->default(0);

            $table->foreign('nest_id')->references('id')->on('nests')->onDelete('cascade');
            $table->foreign('config_from')->references('id')->on('eggs')->onDelete('set null');
            $table->foreign('copy_script_from')->references('id')->on('eggs')->onDelete('set null');
        });

        Schema::create('egg_variables', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('egg_id');
            $table->string('name');
            $table->text('description');
            $table->string('env_variable');
            $table->text('default_value');
            $table->unsignedTinyInteger('user_viewable');
            $table->unsignedTinyInteger('user_editable');
            $table->text('rules');
            $table->string('field_type')->default('text');
            $table->timestamps();

            $table->index(['egg_id', 'env_variable']);
            $table->foreign('egg_id')->references('id')->on('eggs')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('egg_variables');
        Schema::dropIfExists('eggs');
        Schema::dropIfExists('nests');
    }
};
