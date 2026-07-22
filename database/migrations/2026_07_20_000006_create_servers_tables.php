<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Core server tables, plus the deferred allocations.server_id FK that closes
 * the schema's one circular dependency (servers.allocation_id ↔
 * allocations.server_id). The servers core FKs (node, owner, allocation, nest,
 * egg) are intentionally RESTRICT (no onDelete), matching the historical chain.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('servers', function (Blueprint $table) {
            $table->increments('id');
            $table->string('external_id')->nullable()->unique();
            $table->char('uuid', 36)->unique();
            $table->char('uuidShort', 8)->unique();
            $table->unsignedInteger('node_id')->index();
            $table->string('name');
            $table->text('description');
            $table->boolean('mods_enabled')->default(0);
            $table->string('status')->nullable()->index();
            $table->boolean('skip_scripts')->default(0);
            $table->unsignedInteger('owner_id')->index();
            $table->unsignedInteger('memory');
            $table->integer('swap');
            $table->unsignedInteger('disk');
            $table->unsignedInteger('io');
            $table->unsignedInteger('cpu');
            $table->string('threads')->nullable();
            $table->unsignedTinyInteger('oom_killer')->default(1);
            $table->unsignedInteger('allocation_id')->unique();
            $table->unsignedInteger('nest_id')->index();
            $table->unsignedInteger('egg_id')->index();
            $table->text('startup')->nullable();
            $table->string('image');
            $table->unsignedInteger('allocation_limit')->nullable();
            $table->unsignedInteger('database_limit')->nullable()->default(0);
            $table->unsignedInteger('backup_limit')->default(0);
            $table->timestamps();
            $table->timestamp('installed_at')->nullable();
            $table->integer('subuser_limit')->nullable()->default(-1);
            $table->unsignedInteger('subdomain_limit')->nullable()->default(1);
            $table->dateTime('renewal_date')->nullable()->index();
            $table->timestamp('deletion_scheduled_at')->nullable();
            $table->unsignedBigInteger('deletion_scheduled_by')->nullable();
            $table->timestamp('deletion_canceled_at')->nullable();
            $table->timestamp('last_plan_change_at')->nullable();
            $table->unsignedInteger('billing_product_id')->nullable();
            $table->integer('billing_days')->nullable();
            $table->decimal('billing_amount', 10, 2)->nullable();

            $table->foreign('node_id')->references('id')->on('nodes');
            $table->foreign('owner_id')->references('id')->on('users');
            $table->foreign('allocation_id')->references('id')->on('allocations');
            $table->foreign('nest_id')->references('id')->on('nests');
            $table->foreign('egg_id')->references('id')->on('eggs');
        });

        // Close the circular FK deferred from create_nodes_and_allocations_tables.
        Schema::table('allocations', function (Blueprint $table) {
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('set null');
        });

        Schema::create('server_variables', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('variable_id');
            $table->text('variable_value');
            $table->timestamps();

            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('variable_id')->references('id')->on('egg_variables')->onDelete('cascade');
        });

        Schema::create('subusers', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('user_id');
            $table->unsignedInteger('server_id');
            $table->json('permissions')->nullable();
            $table->json('disabled_extensions')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
        });

        Schema::create('server_transfers', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id');
            $table->boolean('successful')->nullable();
            $table->unsignedInteger('old_node');
            $table->unsignedInteger('new_node');
            $table->unsignedInteger('old_allocation');
            $table->unsignedInteger('new_allocation');
            $table->json('old_additional_allocations')->nullable();
            $table->json('new_additional_allocations')->nullable();
            $table->boolean('archived')->default(0);
            $table->timestamps();

            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('server_transfers');
        Schema::dropIfExists('subusers');
        Schema::dropIfExists('server_variables');
        Schema::table('allocations', function (Blueprint $table) {
            $table->dropForeign(['server_id']);
        });
        Schema::dropIfExists('servers');
    }
};
