<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Default per-template email notification toggles. Extracted from the legacy
 * create_email_notification_settings migration (database-rebuild D4).
 * Idempotent: only inserts template keys that don't exist yet, so admin
 * changes to enabled/rate_limit_exempt survive re-seeding.
 */
class EmailNotificationSettingsSeeder extends Seeder
{
    public function run(): void
    {
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

        $this->command->info(sprintf(
            'Added %d missing email notification settings; found %d existing settings.',
            count($insert),
            count($defaults) - count($insert),
        ));

        if ($insert !== []) {
            $this->command->comment('Missing email notification settings added:');
            foreach ($insert as $row) {
                $this->command->line('  + ' . $row['template_key']);
            }
        }
    }
}
