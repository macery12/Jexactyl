<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->unsignedBigInteger('order_id');
            $table->unsignedInteger('user_id');
            $table->string('invoice_number', 30)->unique(); // INV-2026-000001
            $table->string('status', 20)->default('active'); // active, expired, void
            $table->string('file_path')->nullable();
            $table->string('file_disk', 20)->nullable(); // local, s3, r2
            $table->unsignedBigInteger('file_size_bytes')->nullable();
            $table->decimal('total', 10, 2);
            $table->string('currency', 10)->default('USD');
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->unsignedInteger('voided_by')->nullable(); // admin user id
            $table->string('voided_reason')->nullable();
            $table->json('metadata')->nullable(); // snapshot of order/product/user at time of generation
            $table->timestamps();

            $table->foreign('order_id')->references('id')->on('orders')->cascadeOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['user_id', 'status']);
            $table->index(['status', 'expires_at']); // for retention cleanup job
            $table->index('order_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoices');
    }
};
