<?php

namespace Everest\Services\Migration;

use Illuminate\Contracts\Encryption\Encrypter;
use Illuminate\Contracts\Encryption\DecryptException;

/**
 * Carries the two things a transform needs that are not in the row itself:
 * the source panel's encrypter (built from that panel's APP_KEY) and this
 * panel's encrypter.
 *
 * Secrets in the Pterodactyl family — node daemon tokens, database and database
 * host passwords, TOTP secrets, API key tokens — are encrypted with the panel's
 * APP_KEY. They cannot be copied verbatim: they have to be decrypted with the
 * old key and re-encrypted with ours, or the imported panel cannot talk to its
 * own nodes.
 */
class ImportContext
{
    public function __construct(
        private readonly Encrypter $source,
        private readonly Encrypter $target,
    ) {
    }

    /**
     * Re-wrap a secret from the source panel's key to ours.
     *
     * Null and empty values pass through untouched. A value that will not
     * decrypt is fatal: continuing would write a secret nothing can read back,
     * which is worse than stopping.
     *
     * @throws DecryptException
     */
    public function rewrap(?string $value): ?string
    {
        if ($value === null || $value === '') {
            return $value;
        }

        return $this->target->encrypt($this->source->decrypt($value));
    }

    /**
     * Check whether a value decrypts with the source key, without re-encrypting.
     * Used by the pre-flight probe to catch a wrong --source-key before any
     * writes happen.
     */
    public function canDecrypt(?string $value): bool
    {
        if ($value === null || $value === '') {
            return true;
        }

        try {
            $this->source->decrypt($value);
        } catch (DecryptException) {
            return false;
        }

        return true;
    }
}
