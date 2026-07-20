<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('server_custom_domains', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('server_id');
            $table->unsignedInteger('allocation_id')->nullable();
            $table->foreignId('custom_domain_id')->constrained('custom_domains')->cascadeOnDelete();
            $table->string('subdomain');
            $table->string('full_domain');
            $table->unsignedInteger('port');
            $table->enum('protocol', ['tcp', 'udp', 'both'])->default('both');
            $table->boolean('ssl_enabled')->default(false);
            $table->enum('ssl_status', ['disabled', 'pending', 'issued', 'failed'])->default('disabled');
            $table->enum('status', ['pending', 'active', 'failed'])->default('pending');
            $table->json('dns_records')->nullable();
            $table->text('last_error')->nullable();
            $table->timestamp('last_synced_at')->nullable();
            $table->timestamps();

            $table->unique(['full_domain', 'port', 'protocol'], 'server_custom_domains_unique_target');
            $table->index(['server_id', 'status']);
            $table->index('allocation_id');

            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
            $table->foreign('allocation_id')->references('id')->on('allocations')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('server_custom_domains');
    }
};
