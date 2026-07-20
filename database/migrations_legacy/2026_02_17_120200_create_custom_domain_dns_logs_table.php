<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('custom_domain_dns_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('server_id')->nullable();
            $table->foreignId('server_custom_domain_id')->nullable()->constrained('server_custom_domains')->nullOnDelete();
            $table->enum('action', ['create', 'update', 'delete', 'sync', 'ssl']);
            $table->enum('status', ['success', 'failed']);
            $table->json('payload')->nullable();
            $table->text('message')->nullable();
            $table->timestamps();

            $table->index(['server_id', 'created_at']);
            $table->foreign('server_id')->references('id')->on('servers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_domain_dns_logs');
    }
};
