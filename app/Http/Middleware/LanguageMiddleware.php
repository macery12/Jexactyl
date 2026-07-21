<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Foundation\Application;

class LanguageMiddleware
{
    /**
     * LanguageMiddleware constructor.
     */
    public function __construct(private Application $app)
    {
    }

    /**
     * Handle an incoming request and set the user's preferred language. The
     * per-user preference only applies while admins allow user-selected
     * languages (app:user_locale); otherwise the panel default wins.
     */
    public function handle(Request $request, \Closure $next): mixed
    {
        // $request->user() is null for guests (login, password reset, etc.), so
        // fall back to the panel default there rather than reading ->language.
        $preferred = config('app.user_locale', true) ? $request->user()?->language : null;

        $this->app->setLocale($preferred ?? config('app.locale', 'en'));

        return $next($request);
    }
}
