<?php

namespace Everest\Listeners\Auth;

use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Everest\Events\Email\PasswordChanged;
use Illuminate\Auth\Events\PasswordReset;
use Everest\Services\Users\UserCredentialRevocationService;

class PasswordResetListener
{
    protected Request $request;

    public function __construct(Request $request, private UserCredentialRevocationService $credentials)
    {
        $this->request = $request;
    }

    public function handle(PasswordReset $event): void
    {
        $this->credentials->revokeAll($event->user);

        Activity::event('event:password-reset')
            ->withRequestMetadata()
            ->subject($event->user)
            ->log();

        // Dispatch password changed email notification
        event(new PasswordChanged(
            user: $event->user,
            correlationId: \Illuminate\Support\Str::uuid()->toString()
        ));
    }
}
