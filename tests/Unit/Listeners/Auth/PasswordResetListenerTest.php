<?php

namespace Everest\Tests\Unit\Listeners\Auth;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Support\Facades\Event;
use Everest\Events\Email\PasswordChanged;
use Illuminate\Auth\Events\PasswordReset;
use Everest\Services\Auth\UserSessionService;
use Everest\Listeners\Auth\PasswordResetListener;

class PasswordResetListenerTest extends TestCase
{
    public function testSuccessfulResetRevokesEveryExistingSession(): void
    {
        Event::fake([PasswordChanged::class]);
        $user = new User();
        $user->id = 42;

        $sessions = $this->createMock(UserSessionService::class);
        $sessions->expects($this->once())
            ->method('revokeAll')
            ->with($user);

        Activity::shouldReceive('event')
            ->once()
            ->with('event:password-reset')
            ->andReturnSelf();
        Activity::shouldReceive('withRequestMetadata')->once()->andReturnSelf();
        Activity::shouldReceive('subject')->once()->with($user)->andReturnSelf();
        Activity::shouldReceive('log')->once()->andReturnNull();

        (new PasswordResetListener(Request::create('/reset', 'POST'), $sessions))
            ->handle(new PasswordReset($user));

        Event::assertDispatched(
            PasswordChanged::class,
            fn (PasswordChanged $event): bool => $event->user === $user
        );
    }
}
