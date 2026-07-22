<?php

namespace Everest\Observers;

use Everest\Events;
use Everest\Models\User;
use Illuminate\Support\Str;
use Everest\Services\Email\EmailManager;
use Everest\Services\Auth\EmailVerificationService;

class UserObserver
{
    protected string $uuid;

    /**
     * Listen to the User creating event.
     */
    public function creating(User $user): void
    {
        event(new Events\User\Creating($user));
    }

    /**
     * Listen to the User created event.
     */
    public function created(User $user): void
    {
        event(new Events\User\Created($user));

        if ($this->emailSendingEnabled()) {
            // Dispatch email notification for account created
            event(new Events\Email\AccountCreated(
                user: $user,
                correlationId: Str::uuid()->toString()
            ));

            // Send verification email immediately
            app(EmailVerificationService::class)->send($user);
        }
    }

    /**
     * Listen to the User deleting event.
     */
    public function deleting(User $user): void
    {
        event(new Events\User\Deleting($user));
    }

    /**
     * Listen to the User deleted event.
     */
    public function deleted(User $user): void
    {
        event(new Events\User\Deleted($user));
    }

    private function emailSendingEnabled(): bool
    {
        return EmailManager::isDeliveryEnabled();
    }
}
