<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Storefront catalog: categories, products, billing cycles, coupons.
 * categories.egg_id / nest_id and products.category_uuid are plain columns
 * without FKs (linked by uuid/id in app code), matching the historical chain.
 * products.price is double for legacy reasons (see docs/database-rebuild/04 D6).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('categories', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36);
            $table->string('name');
            $table->string('icon')->nullable();
            $table->string('description')->nullable();
            $table->string('visible')->nullable();
            $table->timestamps();
            $table->unsignedInteger('egg_id');
            $table->json('allowed_eggs')->nullable();
            $table->boolean('allow_egg_changes')->default(1);
            $table->boolean('allow_plan_changes')->default(1);
            $table->unsignedInteger('nest_id');
        });

        Schema::create('products', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->char('uuid', 36);
            $table->string('name');
            $table->string('icon')->nullable();
            $table->double('price');
            $table->decimal('base_price', 10, 2)->nullable();
            $table->string('description')->nullable();
            $table->boolean('visible')->nullable();
            $table->unsignedInteger('cpu_limit');
            $table->integer('memory_limit');
            $table->integer('disk_limit');
            $table->unsignedInteger('backup_limit');
            $table->unsignedInteger('database_limit');
            $table->unsignedInteger('allocation_limit');
            $table->unsignedInteger('subdomain_limit')->nullable()->default(1);
            $table->timestamps();
            $table->string('stripe_id')->nullable();
            $table->char('category_uuid', 36)->index();
        });

        Schema::create('billing_cycles', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('product_id');
            $table->integer('days');
            $table->boolean('is_enabled')->default(1);
            $table->timestamps();

            $table->unique(['product_id', 'days']);
            $table->foreign('product_id')->references('id')->on('products')->onDelete('cascade');
        });

        Schema::create('coupons', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('code')->unique();
            $table->enum('type', ['percentage', 'fixed']);
            $table->decimal('value', 10, 2);
            $table->integer('max_uses')->nullable();
            $table->integer('max_uses_per_user')->nullable();
            $table->decimal('min_order_total', 10, 2)->nullable();
            $table->dateTime('expires_at')->nullable();
            $table->boolean('is_active')->default(1);
            $table->enum('allowed_for', ['both', 'purchases', 'renewals'])->default('both');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coupons');
        Schema::dropIfExists('billing_cycles');
        Schema::dropIfExists('products');
        Schema::dropIfExists('categories');
    }
};
