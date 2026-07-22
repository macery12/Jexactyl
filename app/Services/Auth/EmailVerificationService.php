<?php

namespace Everest\Services\Auth;

use Everest\Models\User;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\URL;
use Everest\Services\Email\EmailManager;
use Everest\Events\Email\EmailVerificationRequested;

class EmailVerificationService
{
    private int $expiryMinutes = 60;

    public function send(User $user): void
    {
        if (!$this->emailSendingEnabled()) {
            return;
        }

        if ($user->hasVerifiedEmail()) {
            return;
        }

        // Generate a relative signed path (signature covers only the path, not scheme/domain).
        // This prevents 403 errors caused by scheme mismatches (e.g. http APP_URL vs https
        // access) that occur when the application sits behind a TLS-terminating proxy.
        $signedPath = URL::temporarySignedRoute(
            name: 'auth.verification.verify',
            expiration: now()->addMinutes($this->expiryMinutes),
            parameters: [
                'id' => $user->id,
                'hash' => hash('sha256', $user->email),
            ],
            absolute: false,
        );

        $verificationUrl = rtrim(config('app.url'), '/') . '/' . ltrim($signedPath, '/');

        event(new EmailVerificationRequested(
            user: $user,
            verificationUrl: $verificationUrl,
            correlationId: Str::uuid()->toString(),
        ));
    }

    private function emailSendingEnabled(): bool
    {
        return EmailManager::isDeliveryEnabled();
    }
}
