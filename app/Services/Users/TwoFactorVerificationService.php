<?php

namespace Everest\Services\Users;

use Carbon\Carbon;
use Everest\Models\User;
use PragmaRX\Google2FA\Google2FA;
use Illuminate\Contracts\Encryption\Encrypter;

/**
 * Checks a second factor against an account — either a TOTP code, or one of the
 * one-time recovery tokens issued when two-factor was switched on.
 *
 * Both the login checkpoint and the "disable two-factor" endpoint need exactly
 * this. Keeping a single copy is deliberate: the two TOTP call sites in this
 * codebase had already drifted once, with the login path reading
 * `config('Everest.auth.2fa.window')` — a key that does not exist, so the
 * configured window was silently ignored there and honoured during enrolment.
 */
class TwoFactorVerificationService
{
    public function __construct(
        private Encrypter $encrypter,
        private Google2FA $google2FA,
    ) {
    }

    /**
     * Verify a TOTP code and record when it was accepted.
     *
     * Codes from at or before `totp_authenticated_at` are refused, so one that
     * was shoulder-surfed or replayed from a proxy cannot be used a second time
     * inside its own validity window.
     *
     * @throws \PragmaRX\Google2FA\Exceptions\IncompatibleWithGoogleAuthenticatorException
     * @throws \PragmaRX\Google2FA\Exceptions\InvalidCharactersException
     * @throws \PragmaRX\Google2FA\Exceptions\SecretKeyTooShortException
     */
    public function isValidTotp(User $user, string $code): bool
    {
        if (empty($user->totp_secret)) {
            return false;
        }

        $oldTimestamp = $user->totp_authenticated_at
            ? (int) floor($user->totp_authenticated_at->unix() / $this->google2FA->getKeyRegeneration())
            : null;

        $verified = $this->google2FA->verifyKeyNewer(
            $this->encrypter->decrypt($user->totp_secret),
            $code,
            $oldTimestamp,
            config('everest.auth.2fa.window') ?? 1,
        );

        if ($verified === false) {
            return false;
        }

        $user->update(['totp_authenticated_at' => Carbon::now()]);

        return true;
    }

    /**
     * Verify one of the account's recovery tokens, consuming it on success.
     *
     * They are stored hashed and each is good for exactly one use, so a match
     * deletes the row before returning.
     */
    public function consumeRecoveryToken(User $user, string $value): bool
    {
        foreach ($user->recoveryTokens as $token) {
            if (password_verify($value, $token->token)) {
                $token->delete();

                return true;
            }
        }

        return false;
    }
}
