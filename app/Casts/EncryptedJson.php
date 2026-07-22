<?php

namespace Everest\Casts;

use Illuminate\Database\Eloquent\Model;
use Everest\Services\Billing\InvoiceEncryptionService;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;

/**
 * Eloquent cast that transparently encrypts/decrypts a JSON column using
 * the InvoiceEncryptionService (AES-256, INVOICE_ENCRYPTION_KEY).
 *
 * Get:  ciphertext string  → decrypts → json_decode → array
 * Set:  array              → json_encode → encrypts → ciphertext string
 *
 * Migration safety: if the stored value fails decryption (e.g., it is still
 * plain JSON from before encryption was enabled), falls back to json_decode
 * so existing rows continue to be readable during a rolling migration.
 */
class EncryptedJson implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?array
    {
        if (is_null($value)) {
            return null;
        }

        try {
            return (new InvoiceEncryptionService())->decryptToArray($value);
        } catch (\Throwable) {
            // Fallback: plain JSON stored before encryption was enabled
            $decoded = json_decode($value, associative: true);

            return is_array($decoded) ? $decoded : null;
        }
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if (is_null($value)) {
            return null;
        }

        return (new InvoiceEncryptionService())->encryptArray(
            is_array($value) ? $value : []
        );
    }
}
