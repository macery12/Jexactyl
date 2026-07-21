<?php

namespace Everest\Services\Security;

use Illuminate\Support\Str;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Log;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Encryption\MissingAppKeyException;

class SecretEncryptionService
{
    private const MAX_ENCRYPTED_BYTES = 16384;
    private const MAX_JSON_DEPTH = 3;
    private const MAX_DECRYPTION_ATTEMPTS = 5;

    /**
     * List of setting keys that should always be stored encrypted.
     * Accepts both prefixed (settings::...) and unprefixed (modules:...) keys.
     */
    private array $secretSettingKeys = [
        'settings::modules:billing:keys:secret',
        'settings::modules:billing:paypal_standalone:client_id',
        'settings::modules:billing:paypal_standalone:client_secret',
        'settings::modules:email:resend:api_key',
        'settings::modules:email:resend:api_key',
        'settings::modules:email:smtp:password',
        'settings::modules:ai:key',
        'settings::modules:mods:curseforge_api_key',
        'settings::modules:auth:discord:client_secret',
        'settings::modules:auth:google:client_secret',
    ];

    public function isSecretKey(string $key): bool
    {
        $normalized = $this->normalizeKey($key);

        return in_array($normalized, $this->secretSettingKeys, true);
    }

    public function encryptForStorage(mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return $value;
        }

        if (!$this->hasAppKey()) {
            // Without an application key we cannot safely encrypt; let the caller handle it.
            throw new MissingAppKeyException();
        }

        return Crypt::encryptString((string) $value);
    }

    public function decryptFromStorage(mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return $value;
        }

        if (!$this->hasAppKey()) {
            // When APP_KEY is missing (e.g. key:generate) avoid throwing during boot.
            return null;
        }

        $originalValue = (string) $value;
        $value = $originalValue;

        $attempts = 0;

        // Handle the case where a secret may have been encrypted multiple times by
        // iteratively decrypting while the payload still looks like a Laravel
        // encrypted string. This prevents returning an encrypted blob to
        // downstream services (e.g. payment processors) which would then fail.
        while (
            $attempts < self::MAX_DECRYPTION_ATTEMPTS
            && $this->looksLikeEncryptedPayload($value)
        ) {
            $attempts++;

            // Safety valve: refuse to repeatedly decrypt extremely large payloads.
            if (strlen($value) > self::MAX_ENCRYPTED_BYTES) {
                Log::warning('Secret decryption skipped due to oversized payload.', [
                    'payload_length' => strlen($value),
                ]);

                return null;
            }

            try {
                $value = Crypt::decryptString($value);
            } catch (DecryptException|\RuntimeException) {
                // Likely a legacy plaintext or already decrypted value — return as-is.
                return $originalValue;
            }
        }

        return $value;
    }

    public function normalizeKey(string $key): string
    {
        return Str::startsWith($key, 'settings::') ? $key : 'settings::' . ltrim($key, ':');
    }

    /**
     * Detects whether the given value appears to be a Laravel encrypted payload.
     */
    private function looksLikeEncryptedPayload(string $value): bool
    {
        $decoded = base64_decode($value, true);
        if ($decoded === false) {
            return false;
        }

        try {
            $payload = json_decode($decoded, true, self::MAX_JSON_DEPTH, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }

        $requiredKeys = ['iv', 'value', 'mac'];
        $allowedKeys = [...$requiredKeys, 'tag'];
        $allowedLookup = array_flip($allowedKeys);

        foreach (array_keys($payload) as $key) {
            if (!isset($allowedLookup[$key])) {
                return false;
            }
        }

        foreach ($requiredKeys as $key) {
            if (!isset($payload[$key]) || !is_string($payload[$key])) {
                return false;
            }
        }

        return true;
    }

    private function hasAppKey(): bool
    {
        return !blank(config('app.key'));
    }
}
