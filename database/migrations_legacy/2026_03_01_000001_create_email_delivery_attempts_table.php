<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Defensive creation/upgrade for email_delivery_attempts.
 * Replaces prior experimental migrations for attempts logging.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('email_delivery_attempts')) {
            Schema::create('email_delivery_attempts', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('delivery_id');
                $table->unsignedInteger('attempt_number');
                $table->string('provider')->nullable();
                $table->string('status'); // attempt lifecycle only (sending, sent, failed) distinct from delivery status values (see EmailDeliveryTracker usage; deliveries use queued/sent/failed/deferred/blocked/skipped)
                // response_code is the provider HTTP code; status_code retained for legacy trackers (older EmailDeliveryTracker logs)
                $table->unsignedInteger('response_code')->nullable();
                $table->unsignedInteger('status_code')->nullable();
                $table->string('provider_message_id')->nullable();
                $table->text('error_message')->nullable();
                $table->text('error')->nullable();
                $table->json('raw_response')->nullable();
                $table->text('response_payload')->nullable();
                $table->json('request_payload')->nullable();
                $table->timestamp('started_at')->nullable();
                $table->timestamp('finished_at')->nullable();
                $table->unsignedInteger('duration_ms')->nullable();
                $table->boolean('success')->default(false);
                $table->string('exception_class')->nullable();
                $table->longText('stacktrace')->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->unique(['delivery_id', 'attempt_number']);
                $table->index('provider_message_id');
                $table->foreign('delivery_id')
                    ->references('id')
                    ->on('email_deliveries')
                    ->onDelete('cascade');
            });

            return;
        }

        Schema::table('email_delivery_attempts', function (Blueprint $table) {
            if (!Schema::hasColumn('email_delivery_attempts', 'provider')) {
                $table->string('provider')->nullable()->after('attempt_number');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'status')) {
                $table->string('status')->after('provider');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'response_code')) {
                $table->unsignedInteger('response_code')->nullable()->after('status');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'status_code')) {
                $table->unsignedInteger('status_code')->nullable()->after('response_code');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'provider_message_id')) {
                $table->string('provider_message_id')->nullable()->after('status_code');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'error_message')) {
                $table->text('error_message')->nullable()->after('provider_message_id');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'error')) {
                $table->text('error')->nullable()->after('error_message');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'raw_response')) {
                $table->json('raw_response')->nullable()->after('error');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'response_payload')) {
                $table->text('response_payload')->nullable()->after('raw_response');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'request_payload')) {
                $table->json('request_payload')->nullable()->after('response_payload');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'started_at')) {
                $table->timestamp('started_at')->nullable()->after('request_payload');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'finished_at')) {
                $table->timestamp('finished_at')->nullable()->after('started_at');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'duration_ms')) {
                $table->unsignedInteger('duration_ms')->nullable()->after('finished_at');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'success')) {
                $table->boolean('success')->default(false)->after('duration_ms');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'exception_class')) {
                $table->string('exception_class')->nullable()->after('success');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'stacktrace')) {
                $table->longText('stacktrace')->nullable()->after('exception_class');
            }
            if (!Schema::hasColumn('email_delivery_attempts', 'created_at')) {
                $table->timestamp('created_at')->useCurrent()->after('stacktrace');
            }
        });

        if (!$this->indexExists('email_delivery_attempts', 'email_delivery_attempts_delivery_id_attempt_number_unique')) {
            Schema::table('email_delivery_attempts', function (Blueprint $table) {
                $table->unique(['delivery_id', 'attempt_number'], 'email_delivery_attempts_delivery_id_attempt_number_unique');
            });
        }
        if (!$this->indexExists('email_delivery_attempts', 'email_delivery_attempts_provider_message_id_index') && Schema::hasColumn('email_delivery_attempts', 'provider_message_id')) {
            Schema::table('email_delivery_attempts', fn (Blueprint $table) => $table->index('provider_message_id'));
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('email_delivery_attempts');
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
            return true;
        }
    }
};
