<?php

namespace Everest\Services\Email;

use Everest\Models\Setting;
use Everest\Services\Security\SecretEncryptionService;

class EmailSettingsReader
{
    public function get(string $key, mixed $default = null): mixed
    {
        /** @var SecretEncryptionService $secrets */
        $secrets = app(SecretEncryptionService::class);
        $normalizedKey = $secrets->normalizeKey($key);

        $setting = Setting::query()->where('key', $normalizedKey)->first();
        if (!$setting) {
            return value($default);
        }

        $value = $setting->value;

        if ($secrets->isSecretKey($normalizedKey)) {
            $value = $secrets->decryptFromStorage($value);
        }

        return $value;
    }

    public function deliveryEnabled(): bool
    {
        $raw = $this->get('settings::modules:email:enabled', $this->get('settings::modules:email:resend:enabled', false));

        if (is_bool($raw)) {
            return $raw;
        }

        $value = strtolower((string) $raw);

        return in_array($value, ['1', 'true', 'yes', 'on'], true);
    }

    public function transport(): string
    {
        $transportSetting = $this->get('settings::modules:email:transport', null);
        if ($transportSetting === null) {
            $transportSetting = $this->get('modules:email:transport', null);
        }

        $transport = strtolower((string) ($transportSetting ?? 'smtp'));

        return in_array($transport, ['smtp', 'resend'], true) ? $transport : 'smtp';
    }

    public function adminSettings(): array
    {
        $planResolver = app(ResendPlanResolver::class);
        $quotaService = app(ResendQuotaService::class);
        $planUsage = $quotaService->usage();

        return [
            'transport' => $this->transport(),
            'enabled' => $this->deliveryEnabled(),
            'resend_plan' => $planUsage['plan'],
            'resend_plans' => $planResolver->all(),
            'resend_usage' => $planUsage['usage'],
            'resend_rate_limit' => $planUsage['rate_limit'],
            'resend' => [
                'api_key' => !empty($this->get('settings::modules:email:resend:api_key', '')),
                'from_email' => (string) $this->get('settings::modules:email:resend:from_email', ''),
                'from_name' => (string) $this->get('settings::modules:email:resend:from_name', ''),
                'reply_to' => (string) $this->get('settings::modules:email:resend:reply_to', ''),
            ],
            'smtp' => [
                'host' => (string) $this->get('settings::modules:email:smtp:host', ''),
                'port' => (string) $this->get('settings::modules:email:smtp:port', ''),
                'username' => (string) $this->get('settings::modules:email:smtp:username', ''),
                'password_set' => !empty($this->get('settings::modules:email:smtp:password', '')),
                'encryption' => (string) $this->get('settings::modules:email:smtp:encryption', ''),
                'from_email' => (string) $this->get('settings::modules:email:smtp:from_email', ''),
                'from_name' => (string) $this->get('settings::modules:email:smtp:from_name', ''),
                'reply_to' => (string) $this->get('settings::modules:email:smtp:reply_to', ''),
            ],
        ];
    }
}
