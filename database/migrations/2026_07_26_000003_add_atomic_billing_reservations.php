<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

return new class () extends Migration {
    public function up(): void
    {
        if (
            DB::table('servers')
                ->join('products', 'products.id', '=', 'servers.billing_product_id')
                ->where('products.price', 0)
                ->whereNotNull('servers.billing_product_id')
                ->select(['servers.owner_id', 'servers.billing_product_id'])
                ->groupBy('servers.owner_id', 'servers.billing_product_id')
                ->havingRaw('COUNT(*) > 1')
                ->limit(1)
                ->exists()
        ) {
            throw new RuntimeException('Cannot add free-product entitlements: at least one user owns duplicate servers for the same free product. Reconcile those servers before applying this migration.');
        }

        if (
            DB::table('coupon_usage')
                ->select('order_id')
                ->groupBy('order_id')
                ->havingRaw('COUNT(*) > 1')
                ->limit(1)
                ->exists()
        ) {
            throw new RuntimeException('Cannot add atomic coupon reservations: duplicate coupon usage rows exist for an order.');
        }

        Schema::table('coupon_usage', function (Blueprint $table) {
            $table->string('status', 20)->default('consumed')->after('order_id');
            $table->timestamp('expires_at')->nullable()->after('used_at');
            $table->unique('order_id', 'coupon_usage_order_unique');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->boolean('requires_free_product_entitlement')
                ->default(false)
                ->after('product_id');
        });

        Schema::create('free_product_entitlements', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id');
            $table->unsignedBigInteger('product_id');
            $table->unsignedBigInteger('order_id')->nullable()->unique();
            $table->unsignedInteger('server_id')->nullable()->unique();
            $table->string('status', 20)->default('reserved');
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'product_id'], 'free_entitlement_user_product_unique');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('product_id')->references('id')->on('products')->cascadeOnDelete();
            $table->foreign('order_id')->references('id')->on('orders')->cascadeOnDelete();
            $table->foreign('server_id')->references('id')->on('servers')->cascadeOnDelete();
        });

        $existing = DB::table('servers')
            ->join('products', 'products.id', '=', 'servers.billing_product_id')
            ->where('products.price', 0)
            ->whereNotNull('servers.billing_product_id')
            ->selectRaw('servers.owner_id, servers.billing_product_id, MIN(servers.id) AS server_id')
            ->groupBy('servers.owner_id', 'servers.billing_product_id')
            ->get();

        foreach ($existing as $row) {
            $inserted = DB::table('free_product_entitlements')->insert([
                'user_id' => $row->owner_id,
                'product_id' => $row->billing_product_id,
                'server_id' => $row->server_id,
                'status' => 'consumed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            if (!$inserted) {
                throw new RuntimeException('Failed to backfill a free-product entitlement.');
            }
        }

        if (DB::table('free_product_entitlements')->count() !== $existing->count()) {
            throw new RuntimeException('Free-product entitlement backfill did not create exactly one guard per existing entitlement.');
        }

        if (
            DB::table('servers')
                ->join('products', 'products.id', '=', 'servers.billing_product_id')
                ->where('products.price', 0)
                ->whereNotNull('servers.billing_product_id')
                ->select(['servers.owner_id', 'servers.billing_product_id'])
                ->groupBy('servers.owner_id', 'servers.billing_product_id')
                ->havingRaw('COUNT(*) > 1')
                ->limit(1)
                ->exists()
        ) {
            throw new RuntimeException('Free-product ownership changed during entitlement backfill. Keep all billing and provisioning writers stopped and restore the pre-migration snapshot before retrying.');
        }

        $currentEntitlementCount = DB::table('servers')
            ->join('products', 'products.id', '=', 'servers.billing_product_id')
            ->where('products.price', 0)
            ->whereNotNull('servers.billing_product_id')
            ->select(['servers.owner_id', 'servers.billing_product_id'])
            ->groupBy('servers.owner_id', 'servers.billing_product_id')
            ->get()
            ->count();
        if (DB::table('free_product_entitlements')->count() !== $currentEntitlementCount) {
            throw new RuntimeException('Free-product ownership changed during entitlement backfill. Restore the pre-migration snapshot before retrying.');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('free_product_entitlements');

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('requires_free_product_entitlement');
        });

        Schema::table('coupon_usage', function (Blueprint $table) {
            $table->dropUnique('coupon_usage_order_unique');
            $table->dropColumn(['status', 'expires_at']);
        });
    }
};
