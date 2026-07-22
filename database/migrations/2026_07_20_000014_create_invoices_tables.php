<?php

use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Invoice snapshots, the invoice-settings singleton and encrypted user billing
 * profiles. The invoice_settings default row is seeded by InvoiceSettingsSeeder
 * (docs/database-rebuild/04 D4) — this migration is structure only.
 */
return new class () extends Migration {
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedBigInteger('order_id')->index();
            $table->unsignedInteger('user_id');
            $table->string('invoice_number', 30)->unique();
            $table->string('status', 20)->default('active');
            $table->string('data_path')->nullable();
            $table->string('data_disk', 20)->nullable();
            $table->unsignedBigInteger('data_size_bytes')->nullable();
            $table->string('pdf_cached_path')->nullable();
            $table->timestamp('pdf_cached_at')->nullable();
            $table->timestamp('pdf_expires_at')->nullable()->index();
            $table->decimal('total', 10, 2);
            $table->string('currency', 10)->default('USD');
            $table->timestamp('generated_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('voided_at')->nullable();
            $table->unsignedInteger('voided_by')->nullable();
            $table->string('voided_reason')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
            $table->index(['status', 'expires_at']);
            $table->foreign('order_id')->references('id')->on('orders')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });

        Schema::create('invoice_settings', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('company_name')->default('');
            $table->string('company_address')->default('');
            $table->string('company_city')->default('');
            $table->string('company_state')->default('');
            $table->string('company_zip')->default('');
            $table->string('company_country')->default('');
            $table->string('company_logo_url')->nullable();
            $table->string('company_tax_id')->nullable();
            $table->string('invoice_prefix', 20)->default('INV');
            $table->unsignedInteger('invoice_sequence')->default(0);
            $table->string('storage_driver', 20)->default('local');
            $table->text('storage_config')->nullable();
            $table->unsignedBigInteger('r2_bytes_used')->default(0);
            $table->unsignedBigInteger('r2_bytes_limit')->default(10200547328);
            $table->boolean('auto_cleanup_enabled')->default(0);
            $table->unsignedSmallInteger('auto_cleanup_after_years')->default(3);
            $table->boolean('require_billing_address')->default(0);
            $table->timestamps();
        });

        Schema::create('user_billing_profiles', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedInteger('user_id')->unique();
            $table->text('encrypted_data')->nullable();
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_billing_profiles');
        Schema::dropIfExists('invoice_settings');
        Schema::dropIfExists('invoices');
    }
};
