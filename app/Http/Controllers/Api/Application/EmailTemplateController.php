<?php

namespace Everest\Http\Controllers\Api\Application;

use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Blade;
use Everest\Http\Requests\Api\Application\Email\RevertEmailTemplateRequest;
use Everest\Http\Requests\Api\Application\Email\GetEmailTemplateKeysRequest;
use Everest\Http\Requests\Api\Application\Email\PreviewEmailTemplateRequest;
use Everest\Http\Requests\Api\Application\Email\UpdateEmailTemplateSourceRequest;

class EmailTemplateController extends ApplicationApiController
{
    /**
     * All available email templates with their display metadata, Blade view path, and variable docs.
     *
     * Each entry in 'variables' has:
     *   name        – the variable reference used in the template
     *   description – human-readable purpose
     *   example     – sample value shown in the variable panel
     *   required    – whether the template requires this variable to render
     */
    private const TEMPLATES = [
        'auth.account_created' => [
            'label'    => 'Account Created',
            'category' => 'Auth',
            'view'     => 'emails.auth.account-created',
            'variables' => [
                ['name' => '$userName',  'description' => "Recipient's display name",   'example' => 'Jane Smith',           'required' => true],
                ['name' => '$userEmail', 'description' => "Recipient's email address",  'example' => 'jane@example.com',     'required' => false],
                ['name' => '$loginUrl',  'description' => 'Link to the login page',     'example' => 'https://example.com/login', 'required' => true],
            ],
        ],
        'auth.account_locked' => [
            'label'    => 'Account Locked / Suspended',
            'category' => 'Auth',
            'view'     => 'emails.auth.account-locked',
            'variables' => [
                ['name' => '$userName',    'description' => "Recipient's display name",          'example' => 'Jane Smith',                          'required' => true],
                ['name' => '$reason',      'description' => 'Reason the account was locked',     'example' => 'Multiple failed login attempts',       'required' => false],
                ['name' => '$suspendedAt', 'description' => 'Date/time the account was locked',  'example' => 'April 13, 2026 10:30 AM',             'required' => false],
                ['name' => '$supportUrl',  'description' => 'Link to the support page',          'example' => 'https://example.com/support',         'required' => false],
            ],
        ],
        'auth.account_unsuspended' => [
            'label'    => 'Account Unsuspended',
            'category' => 'Auth',
            'view'     => 'emails.auth.account-unsuspended',
            'variables' => [
                ['name' => '$userName',      'description' => "Recipient's display name",              'example' => 'Jane Smith',              'required' => true],
                ['name' => '$unsuspendedAt', 'description' => 'Date/time the account was unsuspended', 'example' => 'April 13, 2026 2:15 PM', 'required' => false],
            ],
        ],
        'auth.email_verification' => [
            'label'    => 'Email Verification',
            'category' => 'Auth',
            'view'     => 'emails.auth.email-verification',
            'variables' => [
                ['name' => '$userName',        'description' => "Recipient's display name",            'example' => 'Jane Smith',                              'required' => true],
                ['name' => '$verificationUrl', 'description' => 'Email verification link',             'example' => 'https://example.com/verify?token=abc123', 'required' => true],
                ['name' => '$expiresIn',       'description' => 'How long the link is valid',          'example' => '60 minutes',                              'required' => false],
            ],
        ],
        'auth.password_reset' => [
            'label'    => 'Password Reset',
            'category' => 'Auth',
            'view'     => 'emails.auth.password-reset',
            'variables' => [
                ['name' => '$userName',  'description' => "Recipient's display name",       'example' => 'Jane Smith',                           'required' => true],
                ['name' => '$resetUrl',  'description' => 'Password reset link',            'example' => 'https://example.com/reset?token=abc', 'required' => true],
                ['name' => '$expiresIn', 'description' => 'How long the reset link is valid', 'example' => '60 minutes',                         'required' => false],
            ],
        ],
        'auth.password_changed' => [
            'label'    => 'Password Changed',
            'category' => 'Auth',
            'view'     => 'emails.auth.password-changed',
            'variables' => [
                ['name' => '$userName',  'description' => "Recipient's display name",     'example' => 'Jane Smith',             'required' => true],
                ['name' => '$changedAt', 'description' => 'Date/time password was changed', 'example' => 'April 13, 2026 11:45 AM', 'required' => false],
                ['name' => '$ipAddress', 'description' => 'IP address of the request',    'example' => '192.0.2.42',             'required' => false],
            ],
        ],
        'auth.new_login' => [
            'label'    => 'New Login Detected',
            'category' => 'Auth',
            'view'     => 'emails.auth.new-login',
            'variables' => [
                ['name' => '$userName',  'description' => "Recipient's display name",      'example' => 'Jane Smith',                    'required' => true],
                ['name' => '$ipAddress', 'description' => 'IP address of the login',       'example' => '192.0.2.42',                    'required' => false],
                ['name' => '$userAgent', 'description' => 'Browser/device string',         'example' => 'Chrome 124 on macOS Sonoma',    'required' => false],
                ['name' => '$location',  'description' => 'Approximate geographic location', 'example' => 'San Francisco, CA, US',       'required' => false],
                ['name' => '$loginTime', 'description' => 'Date/time of the login',        'example' => 'April 13, 2026 9:00 AM UTC',   'required' => false],
            ],
        ],
        'auth.2fa_enabled' => [
            'label'    => 'Two-Factor Auth Enabled',
            'category' => 'Auth',
            'view'     => 'emails.auth.2fa-enabled',
            'variables' => [
                ['name' => '$userName',  'description' => "Recipient's display name",    'example' => 'Jane Smith',             'required' => true],
                ['name' => '$enabledAt', 'description' => 'Date/time 2FA was enabled',   'example' => 'April 13, 2026 8:55 AM', 'required' => false],
            ],
        ],
        'auth.2fa_disabled' => [
            'label'    => 'Two-Factor Auth Disabled',
            'category' => 'Auth',
            'view'     => 'emails.auth.2fa-disabled',
            'variables' => [
                ['name' => '$userName',   'description' => "Recipient's display name",    'example' => 'Jane Smith',             'required' => true],
                ['name' => '$disabledAt', 'description' => 'Date/time 2FA was disabled',  'example' => 'April 13, 2026 8:55 AM', 'required' => false],
                ['name' => '$ipAddress',  'description' => 'IP address of the request',   'example' => '192.0.2.42',             'required' => false],
            ],
        ],
        'server.created' => [
            'label'    => 'Server Created',
            'category' => 'Server',
            'view'     => 'emails.server.created',
            'variables' => [
                ['name' => '$userName',     'description' => "Recipient's display name",     'example' => 'Jane Smith',             'required' => true],
                ['name' => '$serverName',   'description' => 'Name of the created server',   'example' => 'Survival-Minecraft',     'required' => true],
                ['name' => '$serverId',     'description' => 'Short server identifier',       'example' => 'a1b2c3d4',               'required' => false],
                ['name' => '$serverUrl',    'description' => 'Link to the server panel',      'example' => 'https://example.com/server/a1b2c3d4', 'required' => false],
                ['name' => '$nodeLocation', 'description' => 'Node/datacenter location',      'example' => 'US East (New York)',     'required' => false],
            ],
        ],
        'server.suspended' => [
            'label'    => 'Server Suspended',
            'category' => 'Server',
            'view'     => 'emails.server.suspended',
            'variables' => [
                ['name' => '$userName',    'description' => "Recipient's display name",          'example' => 'Jane Smith',              'required' => true],
                ['name' => '$serverName',  'description' => 'Name of the suspended server',      'example' => 'Survival-Minecraft',      'required' => true],
                ['name' => '$reason',      'description' => 'Reason for suspension',             'example' => 'Payment overdue',         'required' => false],
                ['name' => '$suspendedAt', 'description' => 'Date/time the server was suspended', 'example' => 'April 13, 2026 12:00 PM', 'required' => false],
            ],
        ],
        'server.unsuspended' => [
            'label'    => 'Server Unsuspended',
            'category' => 'Server',
            'view'     => 'emails.server.unsuspended',
            'variables' => [
                ['name' => '$userName',      'description' => "Recipient's display name",              'example' => 'Jane Smith',              'required' => true],
                ['name' => '$serverName',    'description' => 'Name of the unsuspended server',        'example' => 'Survival-Minecraft',      'required' => true],
                ['name' => '$unsuspendedAt', 'description' => 'Date/time the server was unsuspended',  'example' => 'April 13, 2026 3:30 PM',  'required' => false],
            ],
        ],
        'server.expiring_soon' => [
            'label'    => 'Server Expiring Soon',
            'category' => 'Server',
            'view'     => 'emails.server.expiring-soon',
            'variables' => [
                ['name' => '$userName',      'description' => "Recipient's display name",       'example' => 'Jane Smith',                  'required' => true],
                ['name' => '$serverName',    'description' => 'Name of the expiring server',    'example' => 'Survival-Minecraft',          'required' => true],
                ['name' => '$expiresAt',     'description' => 'Expiration date/time',           'example' => 'April 16, 2026 12:00 PM',    'required' => false],
                ['name' => '$daysRemaining', 'description' => 'Days remaining before expiry',   'example' => '3',                          'required' => false],
            ],
        ],
        'billing.payment_received' => [
            'label'    => 'Payment Received',
            'category' => 'Billing',
            'view'     => 'emails.billing.payment-received',
            'variables' => [
                ['name' => '$userName',        'description' => "Recipient's display name",        'example' => 'Jane Smith',                'required' => true],
                ['name' => '$amount',          'description' => 'Payment amount (numeric string)', 'example' => '9.99',                      'required' => true],
                ['name' => '$currency',        'description' => 'Currency code',                   'example' => 'USD',                       'required' => true],
                ['name' => '$paymentMethod',   'description' => 'Payment method description',      'example' => 'Visa •••• 4242',            'required' => false],
                ['name' => '$invoiceId',       'description' => 'Invoice identifier',              'example' => 'INV-2026-04289',            'required' => false],
                ['name' => '$transactionDate', 'description' => 'Date/time of the transaction',   'example' => 'April 13, 2026 10:00 AM',  'required' => false],
                ['name' => '$isRenewal',       'description' => 'Whether this is a renewal payment', 'example' => 'true',                  'required' => false],
                ['name' => '$originalAmount',  'description' => 'Pre-discount amount (if applicable)', 'example' => '12.99',               'required' => false],
                ['name' => '$discountAmount',  'description' => 'Discount amount applied',         'example' => '3.00',                    'required' => false],
                ['name' => '$couponCode',      'description' => 'Coupon code used',                'example' => 'SAVE3',                   'required' => false],
                ['name' => '$billingDays',     'description' => 'Number of days in billing cycle', 'example' => '30',                      'required' => false],
                ['name' => '$billingCycle',    'description' => 'Billing cycle label',             'example' => 'Monthly',                 'required' => false],
            ],
        ],
        'billing.payment_failed' => [
            'label'    => 'Payment Failed',
            'category' => 'Billing',
            'view'     => 'emails.billing.payment-failed',
            'variables' => [
                ['name' => '$userName',      'description' => "Recipient's display name",       'example' => 'Jane Smith',        'required' => true],
                ['name' => '$amount',        'description' => 'Payment amount attempted',       'example' => '9.99',              'required' => true],
                ['name' => '$currency',      'description' => 'Currency code',                  'example' => 'USD',               'required' => true],
                ['name' => '$reason',        'description' => 'Reason the payment failed',      'example' => 'Card declined',     'required' => false],
                ['name' => '$invoiceId',     'description' => 'Invoice identifier',             'example' => 'INV-2026-04289',   'required' => false],
                ['name' => '$retryUrl',      'description' => 'Link to retry or update billing', 'example' => 'https://example.com/billing', 'required' => false],
                ['name' => '$paymentMethod', 'description' => 'Payment method that failed',     'example' => 'Visa •••• 4242',   'required' => false],
                ['name' => '$isRenewal',     'description' => 'Whether this was a renewal attempt', 'example' => 'false',        'required' => false],
            ],
        ],
        'billing.server_renewal_notice' => [
            'label'    => 'Server Renewal Notice',
            'category' => 'Billing',
            'view'     => 'emails.billing.server-renewal-notice',
            'variables' => [
                ['name' => '$userName',       'description' => "Recipient's display name",         'example' => 'Jane Smith',                    'required' => true],
                ['name' => '$serverName',     'description' => 'Name of the server to be renewed', 'example' => 'Survival-Minecraft',            'required' => true],
                ['name' => '$renewalUrl',     'description' => 'Link to the renewal/billing page', 'example' => 'https://example.com/billing',  'required' => false],
                ['name' => '$renewalDate',    'description' => 'Scheduled renewal date',           'example' => 'April 16, 2026',               'required' => false],
                ['name' => '$suspensionTime', 'description' => 'When server will be suspended if unpaid', 'example' => 'April 16, 2026 12:00 PM UTC', 'required' => false],
                ['name' => '$renewalAmount',  'description' => 'Amount due for renewal',           'example' => '9.99',                         'required' => false],
                ['name' => '$currency',       'description' => 'Currency code',                    'example' => 'USD',                          'required' => false],
                ['name' => '$billingDays',    'description' => 'Number of days in billing cycle',  'example' => '30',                           'required' => false],
                ['name' => '$billingCycle',   'description' => 'Billing cycle label',              'example' => 'Monthly',                      'required' => false],
            ],
        ],
        'admin.broadcast' => [
            'label'    => 'Admin Broadcast',
            'category' => 'Admin',
            'view'     => 'emails.admin-broadcast',
            'variables' => [
                ['name' => '$adminName', 'description' => 'Name of the admin sending the message', 'example' => 'Admin',                       'required' => false],
                ['name' => '$message',   'description' => 'Broadcast message body',                'example' => 'Scheduled maintenance tonight.', 'required' => true],
            ],
        ],
    ];

    /**
     * Realistic sample data keyed by template key.
     */
    private const SAMPLE_DATA = [
        'auth.account_created' => [
            'userName'  => 'Jane Smith',
            'userEmail' => 'jane@example.com',
            'loginUrl'  => '#preview-login',
        ],
        'auth.account_locked' => [
            'userName'    => 'Jane Smith',
            'reason'      => 'Multiple failed login attempts detected from suspicious IP addresses.',
            'suspendedAt' => 'April 13, 2026 10:30 AM',
            'supportUrl'  => '#preview-support',
        ],
        'auth.account_unsuspended' => [
            'userName'      => 'Jane Smith',
            'unsuspendedAt' => 'April 13, 2026 2:15 PM',
        ],
        'auth.email_verification' => [
            'userName'        => 'Jane Smith',
            'verificationUrl' => '#preview-verify',
            'expiresIn'       => '60 minutes',
        ],
        'auth.password_reset' => [
            'userName'  => 'Jane Smith',
            'resetUrl'  => '#preview-reset',
            'expiresIn' => '60 minutes',
        ],
        'auth.password_changed' => [
            'userName'  => 'Jane Smith',
            'changedAt' => 'April 13, 2026 11:45 AM',
            'ipAddress' => '192.0.2.42',
        ],
        'auth.new_login' => [
            'userName'  => 'Jane Smith',
            'ipAddress' => '192.0.2.42',
            'userAgent' => 'Chrome 124 on macOS Sonoma',
            'location'  => 'San Francisco, CA, US',
            'loginTime' => 'April 13, 2026 9:00 AM UTC',
        ],
        'auth.2fa_enabled' => [
            'userName'  => 'Jane Smith',
            'enabledAt' => 'April 13, 2026 8:55 AM',
        ],
        'auth.2fa_disabled' => [
            'userName'   => 'Jane Smith',
            'disabledAt' => 'April 13, 2026 8:55 AM',
            'ipAddress'  => '192.0.2.42',
        ],
        'server.created' => [
            'userName'     => 'Jane Smith',
            'serverName'   => 'Survival-Minecraft',
            'serverId'     => 'a1b2c3d4',
            'serverUrl'    => '#preview-server',
            'nodeLocation' => 'US East (New York)',
        ],
        'server.suspended' => [
            'userName'    => 'Jane Smith',
            'serverName'  => 'Survival-Minecraft',
            'reason'      => 'Payment overdue — renewal invoice unpaid for more than 3 days.',
            'suspendedAt' => 'April 13, 2026 12:00 PM',
        ],
        'server.unsuspended' => [
            'userName'      => 'Jane Smith',
            'serverName'    => 'Survival-Minecraft',
            'unsuspendedAt' => 'April 13, 2026 3:30 PM',
        ],
        'server.expiring_soon' => [
            'userName'     => 'Jane Smith',
            'serverName'   => 'Survival-Minecraft',
            'expiresAt'    => 'April 16, 2026 12:00 PM',
            'daysRemaining' => 3,
        ],
        'billing.payment_received' => [
            'userName'        => 'Jane Smith',
            'amount'          => '9.99',
            'currency'        => 'USD',
            'paymentMethod'   => 'Visa •••• 4242',
            'invoiceId'       => 'INV-2026-04289',
            'transactionDate' => 'April 13, 2026 10:00 AM',
            'isRenewal'       => true,
            'originalAmount'  => '12.99',
            'discountAmount'  => '3.00',
            'couponCode'      => 'SAVE3',
            'billingDays'     => 30,
            'billingCycle'    => 'Monthly',
        ],
        'billing.payment_failed' => [
            'userName'      => 'Jane Smith',
            'amount'        => '9.99',
            'currency'      => 'USD',
            'reason'        => 'Your card was declined. Please check your card details or try a different payment method.',
            'invoiceId'     => 'INV-2026-04289',
            'retryUrl'      => '#preview-billing',
            'paymentMethod' => 'Visa •••• 4242',
            'isRenewal'     => false,
        ],
        'billing.server_renewal_notice' => [
            'userName'      => 'Jane Smith',
            'serverName'    => 'Survival-Minecraft',
            'renewalUrl'    => '#preview-renew',
            'renewalDate'   => 'April 16, 2026',
            'suspensionTime' => 'April 16, 2026 12:00 PM UTC',
            'renewalAmount' => '9.99',
            'currency'      => 'USD',
            'billingDays'   => 30,
            'billingCycle'  => 'Monthly',
        ],
        'admin.broadcast' => [
            'adminName' => 'Admin',
            'message'   => "We will be performing scheduled maintenance on April 15, 2026 from 2:00 AM to 4:00 AM UTC.\n\nDuring this window, servers may experience brief interruptions. No data will be lost.\n\nThank you for your patience.",
        ],
    ];

    /**
     * Return the list of available email templates grouped by category.
     */
    public function index(GetEmailTemplateKeysRequest $request): JsonResponse
    {
        $templates = [];
        foreach (self::TEMPLATES as $key => $meta) {
            $customPath = $this->customViewPath($meta['view']);
            $templates[] = [
                'key'           => $key,
                'label'         => $meta['label'],
                'category'      => $meta['category'],
                'variables'     => $meta['variables'] ?? [],
                'is_customized' => file_exists($customPath),
            ];
        }

        return response()->json(['templates' => $templates]);
    }

    /**
     * Render a single template with sample data and return raw HTML.
     * No email is sent — this is a read-only preview.
     * Uses the custom override file when one exists.
     */
    public function preview(PreviewEmailTemplateRequest $request, string $key): Response
    {
        $meta = self::TEMPLATES[$key] ?? null;

        if ($meta === null) {
            abort(404, 'Template not found.');
        }

        $data = self::SAMPLE_DATA[$key] ?? [];

        $customPath = $this->customViewPath($meta['view']);

        if (file_exists($customPath)) {
            $customSource = file_get_contents($customPath);
            $html = Blade::render($customSource, $data, deleteCachedView: true);
        } else {
            $html = view($meta['view'], $data)->render();
        }

        return response($html, 200, [
            'Content-Type'           => 'text/html; charset=UTF-8',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'",
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options'        => 'SAMEORIGIN',
        ]);
    }

    /**
     * Return the raw Blade source of a template file.
     * Returns the custom override if one exists, otherwise the default.
     */
    public function source(PreviewEmailTemplateRequest $request, string $key): JsonResponse
    {
        $meta = self::TEMPLATES[$key] ?? null;

        if ($meta === null) {
            abort(404, 'Template not found.');
        }

        $customPath = $this->customViewPath($meta['view']);

        if (file_exists($customPath)) {
            return response()->json([
                'key'           => $key,
                'content'       => file_get_contents($customPath),
                'is_customized' => true,
            ]);
        }

        $path = $this->viewPath($meta['view']);

        if (!file_exists($path)) {
            abort(404, 'Template file not found on disk.');
        }

        return response()->json([
            'key'           => $key,
            'content'       => file_get_contents($path),
            'is_customized' => false,
        ]);
    }

    /**
     * Save edits as a custom override file alongside the original Blade template.
     * The original file is never modified.
     */
    public function update(UpdateEmailTemplateSourceRequest $request, string $key): JsonResponse
    {
        $meta = self::TEMPLATES[$key] ?? null;

        if ($meta === null) {
            abort(404, 'Template not found.');
        }

        $defaultPath = $this->viewPath($meta['view']);

        if (!file_exists($defaultPath)) {
            abort(404, 'Template file not found on disk.');
        }

        $customPath = $this->customViewPath($meta['view']);
        $customDir  = dirname($customPath);

        if (!is_dir($customDir)) {
            $parentPerms = fileperms(dirname($customDir));
            $dirPerms    = ($parentPerms !== false) ? ($parentPerms & 0777) : 0755;
            if (!mkdir($customDir, $dirPerms, true)) {
                abort(500, 'Failed to create directory for custom template.');
            }
        }

        if (!is_writable($customDir)) {
            abort(403, 'Custom template directory is not writable. Check server file permissions.');
        }

        if (file_exists($customPath) && !is_writable($customPath)) {
            abort(403, 'Custom template file is not writable. Check server file permissions.');
        }

        $content = $request->input('content');

        if (file_put_contents($customPath, $content, LOCK_EX) === false) {
            abort(500, 'Failed to write custom template file.');
        }

        if (function_exists('opcache_invalidate')) {
            opcache_invalidate($customPath, true);
        }

        Log::info('Email template custom override saved by admin.', [
            'key'      => $key,
            'admin_id' => $request->user()?->id,
            'file'     => basename($customPath),
        ]);

        return response()->json([
            'success'       => true,
            'key'           => $key,
            'is_customized' => true,
        ]);
    }

    /**
     * Remove the custom override and revert to the original Blade template.
     */
    public function revert(RevertEmailTemplateRequest $request, string $key): JsonResponse
    {
        $meta = self::TEMPLATES[$key] ?? null;

        if ($meta === null) {
            abort(404, 'Template not found.');
        }

        $customPath = $this->customViewPath($meta['view']);

        if (file_exists($customPath)) {
            if (!unlink($customPath)) {
                abort(500, 'Failed to remove custom template file.');
            }

            Log::info('Email template reverted to default by admin.', [
                'key'      => $key,
                'admin_id' => $request->user()?->id,
            ]);
        }

        return response()->json([
            'success'       => true,
            'key'           => $key,
            'is_customized' => false,
        ]);
    }

    /**
     * Convert a Blade view name (e.g. "emails.auth.account-created") to an absolute file path.
     */
    private function viewPath(string $viewName): string
    {
        return resource_path('views/' . str_replace('.', '/', $viewName) . '.blade.php');
    }

    /**
     * Derive the custom override path from a Blade view name.
     * The custom file is stored next to the original with a ".custom" suffix, e.g.
     * "account-created.blade.php.custom".  This suffix is not recognised by Laravel's
     * view resolver, so it will never be loaded automatically and cannot be overwritten
     * by normal template updates or deploys.
     */
    private function customViewPath(string $viewName): string
    {
        return $this->viewPath($viewName) . '.custom';
    }
}
