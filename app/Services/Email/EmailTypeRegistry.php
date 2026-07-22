<?php

namespace Everest\Services\Email;

use Everest\Events\Email\AccountLocked;
use Everest\Events\Email\PaymentFailed;
use Everest\Events\Email\AccountCreated;
use Everest\Events\Email\PasswordChanged;
use Everest\Events\Email\PaymentReceived;
use Everest\Events\Email\ServerSuspended;
use Everest\Events\Email\NewLoginDetected;
use Everest\Events\Email\TwoFactorEnabled;
use Everest\Events\Email\ServerUnsuspended;
use Everest\Events\Email\TwoFactorDisabled;
use Everest\Events\Email\AccountUnsuspended;
use Everest\Events\Email\ServerCreatedEmail;
use Everest\Events\Email\ServerRenewalNotice;
use Everest\Events\Email\PasswordResetRequested;
use Everest\Events\Email\EmailVerificationRequested;

class EmailTypeRegistry
{
    /**
     * Map event classes to template keys.
     * Uses dot notation for template keys (e.g., 'auth.password_reset').
     * Note: Dots are automatically sanitized to underscores in email tags by EmailMessage.
     */
    private const EVENT_TO_TEMPLATE = [
        AccountCreated::class => 'auth.account_created',
        AccountLocked::class => 'auth.account_locked',
        AccountUnsuspended::class => 'auth.account_unsuspended',
        EmailVerificationRequested::class => 'auth.email_verification',
        PasswordResetRequested::class => 'auth.password_reset',
        PasswordChanged::class => 'auth.password_changed',
        NewLoginDetected::class => 'auth.new_login',
        TwoFactorEnabled::class => 'auth.2fa_enabled',
        TwoFactorDisabled::class => 'auth.2fa_disabled',
        ServerCreatedEmail::class => 'server.created',
        ServerSuspended::class => 'server.suspended',
        ServerUnsuspended::class => 'server.unsuspended',
        PaymentReceived::class => 'billing.payment_received',
        PaymentFailed::class => 'billing.payment_failed',
        ServerRenewalNotice::class => 'billing.server_renewal_notice',
    ];

    /**
     * Define allowed variables for each template.
     * This is a security allowlist - only these variables can be passed to templates.
     * Uses dot notation for template keys (e.g., 'auth.password_reset').
     */
    private const TEMPLATE_VARIABLES = [
        'auth.account_created' => ['userName', 'userEmail', 'loginUrl'],
        'auth.account_locked' => ['userName', 'reason', 'suspendedAt', 'supportUrl'],
        'auth.account_unsuspended' => ['userName', 'unsuspendedAt'],
        'auth.email_verification' => ['userName', 'verificationUrl', 'expiresIn'],
        'auth.password_reset' => ['userName', 'resetUrl', 'expiresIn'],
        'auth.password_changed' => ['userName', 'changedAt', 'ipAddress'],
        'auth.new_login' => ['userName', 'ipAddress', 'userAgent', 'location', 'loginTime'],
        'auth.2fa_enabled' => ['userName', 'enabledAt'],
        'auth.2fa_disabled' => ['userName', 'disabledAt', 'ipAddress'],
        'server.created' => ['userName', 'serverName', 'serverId', 'serverUrl', 'nodeLocation'],
        'server.suspended' => ['userName', 'serverName', 'reason', 'suspendedAt'],
        'server.unsuspended' => ['userName', 'serverName', 'unsuspendedAt'],
        'server.expiring_soon' => ['userName', 'serverName', 'expiresAt', 'daysRemaining'],
        'billing.payment_received' => ['userName', 'amount', 'currency', 'paymentMethod', 'invoiceId', 'transactionDate', 'isRenewal', 'originalAmount', 'discountAmount', 'couponCode', 'billingDays', 'billingCycle', 'invoiceDownloadUrl'],
        'billing.payment_failed' => ['userName', 'amount', 'currency', 'reason', 'invoiceId', 'retryUrl', 'paymentMethod', 'isRenewal'],
        'billing.server_renewal_notice' => ['userName', 'serverName', 'renewalUrl', 'renewalDate', 'suspensionTime', 'renewalAmount', 'currency', 'billingDays', 'billingCycle'],
    ];

    /**
     * Get template key for an event.
     * Uses instanceof to handle proxied events correctly.
     */
    public static function getTemplateKey(object $event): ?string
    {
        // Use instanceof instead of get_class() to handle proxied/queued events
        // Laravel often wraps events in proxies (e.g., PasswordResetRequested_Proxy)
        // which would fail exact class name matching
        foreach (self::EVENT_TO_TEMPLATE as $class => $template) {
            if ($event instanceof $class) {
                return $template;
            }
        }

        return null;
    }

    /**
     * Get allowed variables for a template.
     */
    public static function getAllowedVariables(string $templateKey): array
    {
        return self::TEMPLATE_VARIABLES[$templateKey] ?? [];
    }

    /**
     * Validate that data contains only allowed variables.
     * Returns array of [valid_data, errors].
     */
    public static function validateVariables(string $templateKey, array $data): array
    {
        $allowed = self::getAllowedVariables($templateKey);
        $errors = [];
        $validData = [];

        foreach ($data as $key => $value) {
            if (!in_array($key, $allowed, true)) {
                $errors[] = "Variable '$key' is not allowed for template '$templateKey'";
            } else {
                $validData[$key] = $value;
            }
        }

        // Check for missing required variables (basic ones)
        $required = ['userName']; // userName is required for all templates
        foreach ($required as $req) {
            if (!array_key_exists($req, $data)) {
                $errors[] = "Required variable '$req' is missing for template '$templateKey'";
            }
        }

        return [$validData, $errors];
    }

    /**
     * Extract data from an event for template rendering.
     * Uses instanceof to handle proxied events correctly.
     */
    public static function extractDataFromEvent(object $event): array
    {
        $data = [];

        // Use instanceof instead of switch(get_class()) to handle proxied/queued events
        if ($event instanceof AccountCreated) {
            /** @var AccountCreated $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'userEmail' => $event->user->email,
                'loginUrl' => url('/auth/login'),
            ];
        } elseif ($event instanceof AccountLocked) {
            /** @var AccountLocked $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'reason' => $event->reason,
                'suspendedAt' => now()->format('F j, Y g:i A'),
                'supportUrl' => url('/support'),
            ];
        } elseif ($event instanceof AccountUnsuspended) {
            /** @var AccountUnsuspended $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'unsuspendedAt' => now()->format('F j, Y g:i A'),
            ];
        } elseif ($event instanceof EmailVerificationRequested) {
            /** @var EmailVerificationRequested $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'verificationUrl' => $event->verificationUrl,
                'expiresIn' => '60 minutes',
            ];
        } elseif ($event instanceof PasswordResetRequested) {
            /** @var PasswordResetRequested $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'resetUrl' => $event->resetUrl,
                'expiresIn' => '60 minutes',
            ];
        } elseif ($event instanceof PasswordChanged) {
            /** @var PasswordChanged $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'changedAt' => now()->format('F j, Y g:i A'),
                'ipAddress' => request()->ip() ?? 'Unknown',
            ];
        } elseif ($event instanceof NewLoginDetected) {
            /** @var NewLoginDetected $event */
            $timezone = new \DateTimeZone((string) config('app.timezone'));
            $loginAt = \DateTimeImmutable::createFromInterface($event->loginAt)->setTimezone($timezone);

            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'ipAddress' => $event->ipAddress,
                'userAgent' => $event->userAgent,
                'location' => $event->location ?? 'Unknown', // Could integrate with IP geolocation service
                'loginTime' => $loginAt->format('F j, Y g:i A T'),
            ];
        } elseif ($event instanceof TwoFactorEnabled) {
            /** @var TwoFactorEnabled $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'enabledAt' => now()->format('F j, Y g:i A'),
            ];
        } elseif ($event instanceof TwoFactorDisabled) {
            /** @var TwoFactorDisabled $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'disabledAt' => now()->format('F j, Y g:i A'),
                'ipAddress' => request()->ip() ?? 'Unknown',
            ];
        } elseif ($event instanceof ServerCreatedEmail) {
            /** @var ServerCreatedEmail $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'serverName' => $event->server->name,
                'serverId' => $event->server->uuidShort,
                'serverUrl' => url("/server/{$event->server->uuidShort}"),
                'nodeLocation' => $event->server->node->name ?? 'Unknown',
            ];
        } elseif ($event instanceof ServerSuspended) {
            /** @var ServerSuspended $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'serverName' => $event->server->name,
                'reason' => $event->reason,
                'suspendedAt' => now()->format('F j, Y g:i A'),
            ];
        } elseif ($event instanceof ServerUnsuspended) {
            /** @var ServerUnsuspended $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'serverName' => $event->server->name,
                'unsuspendedAt' => now()->format('F j, Y g:i A'),
            ];
        } elseif ($event instanceof PaymentReceived) {
            /** @var PaymentReceived $event */
            $billingCycle = self::formatBillingCycle($event->billingDays);
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'amount' => number_format($event->amount, 2),
                'currency' => strtoupper($event->currency),
                'paymentMethod' => $event->paymentMethod,
                'invoiceId' => $event->invoiceId ?? 'N/A',
                'transactionDate' => now()->format('F j, Y g:i A'),
                'isRenewal' => $event->isRenewal,
                'originalAmount' => $event->originalAmount ? number_format($event->originalAmount, 2) : null,
                'discountAmount' => $event->discountAmount ? number_format($event->discountAmount, 2) : null,
                'couponCode' => $event->couponCode,
                'billingDays' => $event->billingDays,
                'billingCycle' => $billingCycle,
                'invoiceDownloadUrl' => $event->invoiceDownloadUrl,
            ];
        } elseif ($event instanceof PaymentFailed) {
            /** @var PaymentFailed $event */
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'amount' => number_format($event->amount, 2),
                'currency' => strtoupper($event->currency),
                'reason' => $event->reason,
                'invoiceId' => $event->invoiceId ?? 'N/A',
                'retryUrl' => url('/billing'),
                'paymentMethod' => $event->paymentMethod,
                'isRenewal' => $event->isRenewal,
            ];
        } elseif ($event instanceof ServerRenewalNotice) {
            /** @var ServerRenewalNotice $event */
            $billingCycle = self::formatBillingCycle($event->billingDays);
            $data = [
                'userName' => $event->user->name ?? $event->user->username,
                'serverName' => $event->server->name,
                'renewalUrl' => $event->renewalUrl,
                'renewalDate' => $event->renewalDate,
                'suspensionTime' => $event->suspensionTime,
                'renewalAmount' => number_format($event->renewalAmount, 2),
                'currency' => strtoupper($event->currency),
                'billingDays' => $event->billingDays,
                'billingCycle' => $billingCycle,
            ];
        }

        return $data;
    }

    /**
     * Get recipient email from event.
     */
    public static function getRecipient(object $event): ?string
    {
        // Most events have a user property
        if (property_exists($event, 'user') && $event->user) {
            return $event->user->email;
        }

        return null;
    }

    /**
     * Format billing cycle days into human-readable text.
     */
    private static function formatBillingCycle(?int $days): string
    {
        if (!$days) {
            return 'One-time';
        }

        // Common billing cycles
        if ($days === 1) {
            return 'Daily';
        } elseif ($days === 7) {
            return 'Weekly';
        } elseif ($days === 14) {
            return 'Bi-weekly';
        } elseif ($days === 30) {
            return 'Monthly';
        } elseif ($days === 60) {
            return 'Bi-monthly';
        } elseif ($days === 90) {
            return 'Quarterly';
        } elseif ($days === 180) {
            return 'Semi-annually';
        } elseif ($days === 365) {
            return 'Annually';
        }

        // For custom periods, return as "{X} days"
        return $days . ' days';

    }

    /**
     * Get correlation ID from event.
     */
    public static function getCorrelationId(object $event): ?string
    {
        return property_exists($event, 'correlationId') ? $event->correlationId : null;
    }

    /**
     * Get all registered event-to-template mappings.
     */
    public static function getAllMappings(): array
    {
        return self::EVENT_TO_TEMPLATE;
    }
}
