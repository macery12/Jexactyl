<?php

namespace Everest\Services\Email;

use Illuminate\Support\Str;
use Everest\Models\EmailNotificationSetting;

class EmailPolicyService
{
    public function __construct(private EmailSettingsReader $settings)
    {
    }

    public function isDeliveryEnabled(): bool
    {
        return $this->settings->deliveryEnabled();
    }

    public function isTemplateEnabled(string $templateKey): bool
    {
        return EmailNotificationSetting::isTemplateEnabled($templateKey);
    }

    public function isBlockedRecipient(string $recipient): bool
    {
        if (function_exists('is_blocked_email_recipient')) {
            return is_blocked_email_recipient($recipient);
        }

        if (!filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            return true;
        }

        $domain = Str::lower(Str::afterLast($recipient, '@'));
        $testDomains = array_map('strtolower', config('email.domain_blacklist', []));

        return in_array($domain, $testDomains, true);
    }

    public function validateTemplateData(string $templateKey, array $data): array
    {
        return EmailTypeRegistry::validateVariables($templateKey, $data);
    }
}
