<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Defensive creation/upgrade for email_notification_settings.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Clean up unused global email settings table from earlier attempts.
        Schema::dropIfExists('email_global_settings');

        if (!Schema::hasTable('email_notification_settings')) {
            Schema::create('email_notification_settings', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('tenant_id')->nullable();
                $table->string('template_key')->unique();
                $table->boolean('enabled')->default(true);
                $table->string('category')->default('general')->index();
                $table->string('name');
                $table->text('description')->nullable();
                $table->boolean('rate_limit_exempt')->default(false);
                $table->timestamps();

                $table->index('tenant_id');
                $table->index(['category', 'enabled']);
            });
        } else {
            Schema::table('email_notification_settings', function (Blueprint $table) {
                if (!Schema::hasColumn('email_notification_settings', 'tenant_id')) {
                    $table->unsignedBigInteger('tenant_id')->nullable()->after('id');
                }
                if (!Schema::hasColumn('email_notification_settings', 'template_key')) {
                    $table->string('template_key')->after('tenant_id');
                }
                if (!Schema::hasColumn('email_notification_settings', 'enabled')) {
                    $table->boolean('enabled')->default(true)->after('template_key');
                }
                if (!Schema::hasColumn('email_notification_settings', 'category')) {
                    $table->string('category')->default('general')->after('enabled');
                }
                if (!Schema::hasColumn('email_notification_settings', 'name')) {
                    $table->string('name')->after('category');
                }
                if (!Schema::hasColumn('email_notification_settings', 'description')) {
                    $table->text('description')->nullable()->after('name');
                }
                if (!Schema::hasColumn('email_notification_settings', 'rate_limit_exempt')) {
                    $table->boolean('rate_limit_exempt')->default(false)->after('description');
                }
            });

            if (!$this->indexExists('email_notification_settings', 'email_notification_settings_tenant_id_index') && Schema::hasColumn('email_notification_settings', 'tenant_id')) {
                Schema::table('email_notification_settings', fn (Blueprint $table) => $table->index('tenant_id'));
            }
            if (!$this->indexExists('email_notification_settings', 'email_notification_settings_category_enabled_index') && Schema::hasColumn('email_notification_settings', 'category')) {
                Schema::table('email_notification_settings', fn (Blueprint $table) => $table->index(['category', 'enabled']));
            }
            if (!$this->indexExists('email_notification_settings', 'email_notification_settings_template_key_unique') && Schema::hasColumn('email_notification_settings', 'template_key')) {
                $hasDuplicates = DB::table('email_notification_settings')
                    ->select('template_key', DB::raw('COUNT(*) as total'))
                    ->groupBy('template_key')
                    ->havingRaw('COUNT(*) > 1')
                    ->exists();

                if (!$hasDuplicates) {
                    Schema::table('email_notification_settings', fn (Blueprint $table) => $table->unique('template_key'));
                }
            }
        }

        $this->seedDefaultNotificationSettings();
    }

    public function down(): void
    {
        Schema::dropIfExists('email_notification_settings');
    }

    private function seedDefaultNotificationSettings(): void
    {
        if (!Schema::hasTable('email_notification_settings')) {
            return;
        }

        $existingKeys = DB::table('email_notification_settings')->pluck('template_key')->all();

        $defaults = [
            ['template_key' => 'auth.account_created', 'enabled' => true, 'category' => 'auth', 'name' => 'Account Created', 'description' => 'Welcome email sent when a new account is created', 'rate_limit_exempt' => false],
            ['template_key' => 'auth.email_verification', 'enabled' => true, 'category' => 'auth', 'name' => 'Email Verification', 'description' => 'Email verification link sent to new users', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.password_reset', 'enabled' => true, 'category' => 'auth', 'name' => 'Password Reset Request', 'description' => 'Password reset link sent when requested', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.password_changed', 'enabled' => true, 'category' => 'auth', 'name' => 'Password Successfully Changed', 'description' => 'Confirmation email after password change', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.new_login', 'enabled' => true, 'category' => 'auth', 'name' => 'New Login Detected', 'description' => 'Alert for new login from unrecognized device/location', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.account_locked', 'enabled' => true, 'category' => 'auth', 'name' => 'Account Locked/Suspended', 'description' => 'Notification when account is locked or suspended', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.account_unsuspended', 'enabled' => true, 'category' => 'auth', 'name' => 'Account Unsuspended', 'description' => 'Notification when account is unsuspended', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.2fa_enabled', 'enabled' => true, 'category' => 'auth', 'name' => '2FA Enabled', 'description' => 'Confirmation when two-factor authentication is enabled', 'rate_limit_exempt' => true],
            ['template_key' => 'auth.2fa_disabled', 'enabled' => true, 'category' => 'auth', 'name' => '2FA Disabled', 'description' => 'Alert when two-factor authentication is disabled', 'rate_limit_exempt' => true],
            ['template_key' => 'server.created', 'enabled' => true, 'category' => 'server', 'name' => 'Server Created', 'description' => 'Notification when a new server is created', 'rate_limit_exempt' => false],
            ['template_key' => 'server.suspended', 'enabled' => true, 'category' => 'server', 'name' => 'Server Suspended', 'description' => 'Notification when a server is suspended', 'rate_limit_exempt' => false],
            ['template_key' => 'server.unsuspended', 'enabled' => true, 'category' => 'server', 'name' => 'Server Unsuspended', 'description' => 'Notification when a server is unsuspended', 'rate_limit_exempt' => false],
            ['template_key' => 'server.expiring_soon', 'enabled' => false, 'category' => 'server', 'name' => 'Server Expiring Soon', 'description' => 'Alert when server is approaching expiration', 'rate_limit_exempt' => false],
            ['template_key' => 'billing.payment_received', 'enabled' => true, 'category' => 'billing', 'name' => 'Payment Received', 'description' => 'Confirmation when payment is successfully processed', 'rate_limit_exempt' => false],
            ['template_key' => 'billing.payment_failed', 'enabled' => true, 'category' => 'billing', 'name' => 'Payment Failed', 'description' => 'Alert when a payment attempt fails', 'rate_limit_exempt' => false],
            ['template_key' => 'billing.server_renewal_notice', 'enabled' => true, 'category' => 'billing', 'name' => 'Server Renewal Notice', 'description' => 'Reminder before server expires with renewal link and suspension time', 'rate_limit_exempt' => false],
        ];

        $now = now();
        $insert = [];
        foreach ($defaults as $row) {
            if (!in_array($row['template_key'], $existingKeys, true)) {
                $row['created_at'] = $now;
                $row['updated_at'] = $now;
                $insert[] = $row;
            }
        }

        if (!empty($insert)) {
            DB::table('email_notification_settings')->insert($insert);
        }
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
