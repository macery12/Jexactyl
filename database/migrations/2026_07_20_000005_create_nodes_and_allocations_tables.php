<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Database hosts, nodes and allocations. allocations.server_id is created here
 * WITHOUT its foreign key — servers doesn't exist yet and servers.allocation_id
 * points back at allocations (the schema's one deliberate circular FK). The FK
 * is added in 0001_01_01_000006_create_servers_tables.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('database_hosts', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name');
            $table->string('host');
            $table->unsignedInteger('port');
            $table->string('username');
            $table->text('password');
            $table->unsignedInteger('max_databases')->nullable();
            $table->timestamps();
        });

        Schema::create('nodes', function (Blueprint $table) {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedSmallInteger('public');
            $table->string('name');
            $table->text('description')->nullable();
            $table->unsignedInteger('database_host_id')->nullable()->index();
            $table->string('fqdn');
            $table->unsignedInteger('listen_port_http')->default(8080);
            $table->unsignedInteger('listen_port_sftp')->default(2022);
            $table->unsignedInteger('public_port_http')->default(8080);
            $table->unsignedInteger('public_port_sftp')->default(2022);
            $table->string('scheme')->default('https');
            $table->boolean('behind_proxy')->default(0);
            $table->boolean('maintenance_mode')->default(0);
            $table->string('wings_type', 20)->default('default');
            $table->string('wings_version', 50)->nullable();
            $table->timestamp('wings_detected_at')->nullable();
            $table->unsignedInteger('memory');
            $table->integer('memory_overallocate')->default(0);
            $table->unsignedInteger('disk');
            $table->integer('disk_overallocate')->default(0);
            $table->unsignedInteger('upload_size')->default(100);
            $table->char('daemon_token_id', 16)->unique();
            $table->text('daemon_token');
            $table->string('daemon_base')->default('/home/daemon-files');
            $table->timestamps();
            $table->boolean('deployable')->nullable()->default(0);
            $table->boolean('deployable_free')->nullable()->default(0);
            $table->decimal('price_multiplier', 5, 2)->default(1.00);
            $table->string('price_multiplier_description', 500)->nullable();

            $table->foreign('database_host_id')->references('id')->on('database_hosts')->onDelete('set null');
        });

        Schema::create('allocations', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('node_id');
            $table->string('ip');
            $table->text('ip_alias')->nullable();
            $table->unsignedMediumInteger('port');
            // FK added in create_servers_tables (circular dependency).
            $table->unsignedInteger('server_id')->nullable();
            $table->string('notes')->nullable();
            $table->timestamps();

            $table->unique(['node_id', 'ip', 'port']);
            $table->foreign('node_id')->references('id')->on('nodes')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('allocations');
        Schema::dropIfExists('nodes');
        Schema::dropIfExists('database_hosts');
    }
};
