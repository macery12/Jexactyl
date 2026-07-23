<?php

namespace Everest\Services\Billing;

use Illuminate\Encryption\Encrypter;

/**
 * Handles AES-256-CBC encryption/decryption for invoice data (snapshots) and
 * storage credentials, using a dedicated key distinct from the application key.
 *
 * Key resolution order:
 *   1. INVOICE_ENCRYPTION_KEY env var (recommended — allows independent rotation)
 *   2. APP_KEY as fallback (convenient for dev, not ideal for prod)
 *
 * Key formats accepted:
 *   - "base64:XXXX…" (Laravel standard format, 32-byte base64-encoded key)
 *   - Raw string — SHA-256 hashed to exactly 32 bytes automatically
 *
 * IMPORTANT: Rotating INVOICE_ENCRYPTION_KEY requires re-encrypting all existing
 * data. Provide a migration script before changing the key in production.
 */
class InvoiceEncryptionService
{
    private readonly Encrypter $encrypter;

    public function __construct()
    {
        // Routed through config so the key survives `config:cache` (env() returns
        // null once the config is cached, which would silently fall back to APP_KEY).
        $raw = config('modules.billing.invoice_encryption_key') ?: config('app.key', '');

        if (str_starts_with($raw, 'base64:')) {
            $key = base64_decode(substr($raw, 7), strict: true);
        } else {
            // Hash arbitrary string to exactly 32 bytes
            $key = hash('sha256', $raw, true);
        }

        $this->encrypter = new Encrypter($key, 'AES-256-CBC');
    }

    /**
     * Encrypt an arbitrary string value and return the ciphertext.
     */
    public function encrypt(string $value): string
    {
        return $this->encrypter->encryptString($value);
    }

    /**
     * Decrypt a ciphertext back to its original string.
     *
     * @throws \Illuminate\Contracts\Encryption\DecryptException on failure
     */
    public function decrypt(string $ciphertext): string
    {
        return $this->encrypter->decryptString($ciphertext);
    }

    /**
     * JSON-encode an array then encrypt it, returning the ciphertext.
     */
    public function encryptArray(array $data): string
    {
        return $this->encrypt(json_encode($data, JSON_THROW_ON_ERROR));
    }

    /**
     * Decrypt a ciphertext and JSON-decode it back to an array.
     *
     * @throws \Illuminate\Contracts\Encryption\DecryptException on tampered/wrong-key data
     * @throws \JsonException on corrupt JSON after decryption
     */
    public function decryptToArray(string $ciphertext): array
    {
        return json_decode($this->decrypt($ciphertext), associative: true, flags: JSON_THROW_ON_ERROR);
    }
}
