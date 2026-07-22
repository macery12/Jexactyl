<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Custom (sub)domain system: Cloudflare API keys, admin-managed base domains,
 * per-server subdomain claims and DNS operation logs. The unique key on
 * server_custom_domains keeps its historical custom name
 * (server_custom_domains_unique_target).
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('custom_domain_api_keys', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('name')->unique();
            $table->text('token');
            $table->boolean('enabled')->default(1);
            $table->timestamps();
        });

        Schema::create('custom_domains', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('domain')->unique();
            $table->string('cloudflare_zone_id')->nullable();
            $table->unsignedBigInteger('api_key_id')->nullable();
            $table->json('allowed_nest_ids')->nullable();
            $table->json('allowed_egg_ids')->nullable();
            $table->string('service_tag')->nullable();
            $table->json('egg_service_tags')->nullable();
            $table->boolean('wildcard_enabled')->default(0);
            $table->boolean('enabled')->default(1);
            $table->timestamps();

            $table->foreign('api_key_id')->references('id')->on('custom_domain_api_keys')->onDelete('set null');
        });

        Schema::create('server_custom_domains', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('allocation_id')->nullable()->index();
            $table->unsignedBigInteger('custom_domain_id');
            $table->string('subdomain');
            $table->string('full_domain');
            $table->unsignedInteger('port');
            $table->enum('protocol', ['tcp', 'udp', 'both'])->default('both');
            $table->enum('record_type', ['srv', 'cname'])->nullable();
            $table->string('service_tag')->nullable();
            $table->enum('status', ['pending', 'active', 'failed'])->default('pending');
            $table->json('dns_records')->nullable();
            $table->text('last_error')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();

            $table->unique(['full_domain', 'port', 'protocol'], 'server_custom_domains_unique_target');
            $table->index(['server_id', 'status']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('cascade');
            $table->foreign('allocation_id')->references('id')->on('allocations')->onDelete('set null');
            $table->foreign('custom_domain_id')->references('id')->on('custom_domains')->onDelete('cascade');
        });

        Schema::create('custom_domain_dns_logs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedBigInteger('server_custom_domain_id')->nullable();
            $table->enum('action', ['create', 'update', 'delete', 'sync', 'ssl']);
            $table->enum('status', ['success', 'failed']);
            $table->json('payload')->nullable();
            $table->text('message')->nullable();
            $table->timestamps();

            $table->index(['server_id', 'created_at']);
            $table->foreign('server_id')->references('id')->on('servers')->onDelete('set null');
            $table->foreign('server_custom_domain_id')->references('id')->on('server_custom_domains')->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_domain_dns_logs');
        Schema::dropIfExists('server_custom_domains');
        Schema::dropIfExists('custom_domains');
        Schema::dropIfExists('custom_domain_api_keys');
    }
};
