<?php

namespace Everest\Services\CustomDomains;

use Everest\Models\Setting;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Contracts\Encryption\DecryptException;
use Everest\Services\Security\SecretEncryptionService;

class CloudflareCredentialService
{
    // Generic settings readers see only ciphertext. Decryption is confined to
    // the outbound Cloudflare client; this key is never hydrated into config.
    public const KEY = 'settings::modules:custom_domains:cloudflare:encrypted_token';
    public const LEGACY_KEY = 'settings::modules:custom_domains:cloudflare:token';

    public function configured(): bool
    {
        return (string) Setting::get(self::KEY, '') !== '';
    }

    public function replace(#[\SensitiveParameter] string $token): void
    {
        if (trim($token) !== '') {
            Setting::set(self::KEY, app(SecretEncryptionService::class)->encryptForStorage(trim($token)));
        }
    }

    public function clear(): void
    {
        Setting::set(self::KEY, '');
    }

    public function token(): string
    {
        $encrypted = (string) Setting::get(self::KEY, '');
        if ($encrypted === '') {
            return '';
        }
        if (blank(config('app.key'))) {
            throw new \RuntimeException('The custom domains credential could not be decrypted. Configure the application encryption key.');
        }

        try {
            return Crypt::decryptString($encrypted);
        } catch (DecryptException) {
            // Do not attach the original exception or fall back to plaintext.
            throw new \RuntimeException('The custom domains credential could not be decrypted. Replace it in settings.');
        }
    }
}
