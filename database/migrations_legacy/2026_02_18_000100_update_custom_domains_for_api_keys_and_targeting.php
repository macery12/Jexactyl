<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('custom_domains', function (Blueprint $table) {
            $table->foreignId('api_key_id')->nullable()->after('cloudflare_zone_id')->constrained('custom_domain_api_keys')->nullOnDelete();
            $table->json('allowed_nest_ids')->nullable()->after('api_key_id');
            $table->json('allowed_egg_ids')->nullable()->after('allowed_nest_ids');
            $table->string('service_tag')->nullable()->after('allowed_egg_ids');
        });

        Schema::table('server_custom_domains', function (Blueprint $table) {
            $table->dropColumn('ssl_enabled');
            $table->dropColumn('ssl_status');
            $table->string('service_tag')->nullable()->after('protocol');
        });
    }

    public function down(): void
    {
        Schema::table('server_custom_domains', function (Blueprint $table) {
            $table->dropColumn('service_tag');

            $table->boolean('ssl_enabled')->default(false);
            $table->enum('ssl_status', ['disabled', 'pending', 'issued', 'failed'])->default('disabled');
        });

        Schema::table('custom_domains', function (Blueprint $table) {
            $table->dropColumn('service_tag');
            $table->dropColumn('allowed_egg_ids');
            $table->dropColumn('allowed_nest_ids');

            $table->dropConstrainedForeignId('api_key_id');
        });
    }
};
