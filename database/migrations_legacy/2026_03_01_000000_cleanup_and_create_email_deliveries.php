<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Defensive creation/upgrade for email_deliveries and legacy cleanup.
 * Replaces prior experimental email migrations for deliveries.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Remove legacy email_logs table if it still exists.
        Schema::dropIfExists('email_logs');

        if (!Schema::hasTable('email_deliveries')) {
            Schema::create('email_deliveries', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('tenant_id')->nullable();
                $table->uuid('correlation_id')->nullable()->unique();
                $table->string('template_key')->nullable();
                $table->string('recipient');
                $table->string('recipient_email')->nullable();
                $table->unsignedInteger('user_id')->nullable();
                $table->string('subject');
                $table->string('status')->default('queued'); // queued, sent, failed, deferred, blocked, skipped (validated in application layer, see EmailDelivery status constants)
                $table->string('provider')->nullable()->default('resend');
                $table->string('provider_message_id')->nullable();
                $table->json('metadata')->nullable();
                $table->unsignedInteger('attempts')->default(0);
                $table->timestamp('last_attempt_at')->nullable();
                $table->timestamp('sent_at')->nullable();
                $table->string('last_message_id')->nullable();
                $table->unsignedInteger('last_status_code')->nullable();
                $table->text('last_error')->nullable();
                $table->json('tags')->nullable();
                $table->timestamps();

                $table->index('tenant_id');
                $table->index(['user_id', 'created_at']);
                $table->index(['template_key', 'created_at']);
                $table->index(['status', 'created_at']);
                $table->index('recipient');
                $table->index('recipient_email');

                $table->foreign('user_id')
                    ->references('id')
                    ->on('users')
                    ->onDelete('set null');
            });

            return;
        }

        Schema::table('email_deliveries', function (Blueprint $table) {
            if (!Schema::hasColumn('email_deliveries', 'tenant_id')) {
                $table->unsignedBigInteger('tenant_id')->nullable()->after('id');
            }
            if (!Schema::hasColumn('email_deliveries', 'correlation_id')) {
                $table->uuid('correlation_id')->nullable()->after('tenant_id');
            }
            if (!Schema::hasColumn('email_deliveries', 'template_key')) {
                $table->string('template_key')->nullable()->after('correlation_id');
            }
            if (!Schema::hasColumn('email_deliveries', 'recipient')) {
                $table->string('recipient')->after('template_key');
            }
            if (!Schema::hasColumn('email_deliveries', 'recipient_email')) {
                $table->string('recipient_email')->nullable()->after('recipient');
            }
            if (!Schema::hasColumn('email_deliveries', 'user_id')) {
                $table->unsignedInteger('user_id')->nullable()->after('recipient_email');
            }
            if (!Schema::hasColumn('email_deliveries', 'subject')) {
                $table->string('subject')->after('user_id');
            }
            if (!Schema::hasColumn('email_deliveries', 'status')) {
                $table->string('status')->default('queued')->after('subject');
            }
            if (!Schema::hasColumn('email_deliveries', 'provider')) {
                $table->string('provider')->nullable()->default('resend')->after('status');
            }
            if (!Schema::hasColumn('email_deliveries', 'provider_message_id')) {
                $table->string('provider_message_id')->nullable()->after('provider');
            }
            if (!Schema::hasColumn('email_deliveries', 'metadata')) {
                $table->json('metadata')->nullable()->after('provider_message_id');
            }
            if (!Schema::hasColumn('email_deliveries', 'attempts')) {
                $table->unsignedInteger('attempts')->default(0)->after('metadata');
            }
            if (!Schema::hasColumn('email_deliveries', 'last_attempt_at')) {
                $table->timestamp('last_attempt_at')->nullable()->after('attempts');
            }
            if (!Schema::hasColumn('email_deliveries', 'sent_at')) {
                $table->timestamp('sent_at')->nullable()->after('last_attempt_at');
            }
            if (!Schema::hasColumn('email_deliveries', 'last_message_id')) {
                $table->string('last_message_id')->nullable()->after('sent_at');
            }
            if (!Schema::hasColumn('email_deliveries', 'last_status_code')) {
                $table->unsignedInteger('last_status_code')->nullable()->after('last_message_id');
            }
            if (!Schema::hasColumn('email_deliveries', 'last_error')) {
                $table->text('last_error')->nullable()->after('last_status_code');
            }
            if (!Schema::hasColumn('email_deliveries', 'tags')) {
                $table->json('tags')->nullable()->after('last_error');
            }
        });

        // Index/unique guards for existing tables.
        if (!$this->indexExists('email_deliveries', 'email_deliveries_tenant_id_index') && Schema::hasColumn('email_deliveries', 'tenant_id')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->index('tenant_id'));
        }
        if (!$this->indexExists('email_deliveries', 'email_deliveries_user_id_created_at_index') && Schema::hasColumn('email_deliveries', 'user_id')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->index(['user_id', 'created_at']));
        }
        if (!$this->indexExists('email_deliveries', 'email_deliveries_template_key_created_at_index') && Schema::hasColumn('email_deliveries', 'template_key')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->index(['template_key', 'created_at']));
        }
        if (!$this->indexExists('email_deliveries', 'email_deliveries_status_created_at_index') && Schema::hasColumn('email_deliveries', 'status')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->index(['status', 'created_at']));
        }
        if (!$this->indexExists('email_deliveries', 'email_deliveries_recipient_index') && Schema::hasColumn('email_deliveries', 'recipient')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->index('recipient'));
        }
        if (!$this->indexExists('email_deliveries', 'email_deliveries_recipient_email_index') && Schema::hasColumn('email_deliveries', 'recipient_email')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->index('recipient_email'));
        }
        if (!$this->indexExists('email_deliveries', 'email_deliveries_correlation_id_unique') && Schema::hasColumn('email_deliveries', 'correlation_id')) {
            Schema::table('email_deliveries', fn (Blueprint $table) => $table->unique('correlation_id'));
        }

        // Simple backfill for optional columns.
        if (Schema::hasColumn('email_deliveries', 'recipient') && Schema::hasColumn('email_deliveries', 'recipient_email')) {
            DB::statement('UPDATE email_deliveries SET recipient_email = recipient WHERE recipient_email IS NULL');
        }
        if (Schema::hasColumn('email_deliveries', 'last_message_id') && Schema::hasColumn('email_deliveries', 'provider_message_id')) {
            DB::statement('UPDATE email_deliveries SET provider_message_id = last_message_id WHERE provider_message_id IS NULL AND last_message_id IS NOT NULL');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('email_deliveries');
    }

    private function indexExists(string $table, string $indexName): bool
    {
        try {
            $connection = Schema::getConnection();
            $schemaManager = $connection->getDoctrineSchemaManager();
            $tablePrefix = $connection->getTablePrefix();
            $indexes = $schemaManager->listTableIndexes($tablePrefix . $table);

            return array_key_exists($indexName, $indexes);
        } catch (\Throwable $e) {
            // If inspection fails, assume index exists to avoid duplicate creation errors.
            return true;
        }
    }
};
