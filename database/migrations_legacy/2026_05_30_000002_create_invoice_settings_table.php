<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoice_settings', function (Blueprint $table) {
            $table->id();

            // Company / branding info
            $table->string('company_name')->default('');
            $table->string('company_address')->default('');
            $table->string('company_city')->default('');
            $table->string('company_state')->default('');
            $table->string('company_zip')->default('');
            $table->string('company_country')->default('');
            $table->string('company_logo_url')->nullable();
            $table->string('company_tax_id')->nullable();

            // Invoice numbering
            $table->string('invoice_prefix', 20)->default('INV');
            $table->unsignedInteger('invoice_sequence')->default(0); // last used sequence number per year

            // Retention
            $table->unsignedInteger('retention_days')->default(365);

            // Storage
            $table->string('storage_driver', 20)->default('local'); // local, s3, r2
            $table->json('storage_config')->nullable(); // driver-specific config (keys, bucket, etc.)

            // R2 usage tracking
            $table->unsignedBigInteger('r2_bytes_used')->default(0);
            $table->unsignedBigInteger('r2_bytes_limit')->default(10200547328); // 9.5 GiB in bytes

            $table->timestamps();
        });

        // Seed a single default row
        DB::table('invoice_settings')->insert([
            'company_name' => config('app.name', ''),
            'invoice_prefix' => 'INV',
            'invoice_sequence' => 0,
            'retention_days' => 365,
            'storage_driver' => 'local',
            'r2_bytes_used' => 0,
            'r2_bytes_limit' => 10200547328,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_settings');
    }
};
