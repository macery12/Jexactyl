<?php

namespace Everest\Providers;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Subuser;
use Everest\Models\EggVariable;
use Everest\Observers\UserObserver;
use Everest\Observers\ServerObserver;
use Everest\Observers\SubuserObserver;
use Illuminate\Auth\Events\PasswordReset;
use Everest\Observers\EggVariableObserver;
use Everest\Listeners\Auth\PasswordResetListener;
use Everest\Listeners\Auth\AuthenticationListener;
use Everest\Listeners\Email\EmailNotificationListener;
use Illuminate\Foundation\Support\Providers\EventServiceProvider as ServiceProvider;

class EventServiceProvider extends ServiceProvider
{
    protected $listen = [
        PasswordReset::class => [
            PasswordResetListener::class,
        ],
    ];

    protected $subscribe = [
        AuthenticationListener::class,
        EmailNotificationListener::class,
    ];

    /**
     * Register any events for your application.
     */
    public function boot(): void
    {
        parent::boot();

        User::observe(UserObserver::class);
        Server::observe(ServerObserver::class);
        Subuser::observe(SubuserObserver::class);
        EggVariable::observe(EggVariableObserver::class);
    }
}
