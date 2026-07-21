<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Performance indexes identified during the June 2026 audit.
 *
 * Each index is guarded by column- and index-existence checks so the migration is
 * idempotent and safe on installs that already added one of these indexes by hand.
 */
return new class extends Migration {
    public function up(): void
    {
        // Ordered/ranged on the activity feed (ActivityLogController).
        $this->ensureIndex('activity_logs', ['timestamp']);

        // Serves the compatible-server lookup (AccountModpacksController) and per-egg
        // variable filtering by env_variable.
        $this->ensureIndex('egg_variables', ['egg_id', 'env_variable']);

        // Storefront product listing by category (Client\Billing\ProductController).
        $this->ensureIndex('products', ['category_uuid']);

        // Suspended-server billing queries (Application\Billing\BillingController).
        $this->ensureIndex('servers', ['status']);

        // Date-ranged admin dashboards over the audit trail.
        $this->ensureIndex('audit_logs', ['created_at']);
    }

    public function down(): void
    {
        $this->dropIndexIfExists('activity_logs', ['timestamp']);
        $this->dropIndexIfExists('egg_variables', ['egg_id', 'env_variable']);
        $this->dropIndexIfExists('products', ['category_uuid']);
        $this->dropIndexIfExists('servers', ['status']);
        $this->dropIndexIfExists('audit_logs', ['created_at']);
    }

    private function indexName(string $table, array $columns): string
    {
        return $table . '_' . implode('_', $columns) . '_index';
    }

    private function ensureIndex(string $table, array $columns): void
    {
        try {
            foreach ($columns as $column) {
                if (!Schema::hasColumn($table, $column)) {
                    return;
                }
            }

            if (Schema::hasIndex($table, $this->indexName($table, $columns))) {
                return;
            }

            Schema::table($table, fn (Blueprint $t) => $t->index($columns));
        } catch (\Throwable $ignored) {
            // Be resilient on drivers without full schema introspection (e.g. sqlite in CI).
        }
    }

    private function dropIndexIfExists(string $table, array $columns): void
    {
        try {
            if (Schema::hasIndex($table, $this->indexName($table, $columns))) {
                Schema::table($table, fn (Blueprint $t) => $t->dropIndex($this->indexName($table, $columns)));
            }
        } catch (\Throwable $ignored) {
            //
        }
    }
};
