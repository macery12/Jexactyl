<?php

use Everest\Http\Controllers\Auth;
use Everest\Http\Controllers\Base;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Authentication Routes
|--------------------------------------------------------------------------
|
| Endpoint: /auth
|
*/

// These routes are defined so that we can continue to reference them programmatically.
// They all serve the V2 shell — the SPA owns the auth pages.
Route::get('/login', [Base\IndexController::class, 'v2'])->name('auth.login');
Route::get('/password', [Base\IndexController::class, 'v2'])->name('auth.forgot-password');
Route::get('/password/reset/{token}', [Base\IndexController::class, 'v2'])->name('auth.reset');
Route::prefix('/password-reset')->group(function () {
    Route::get('/method', [Auth\ForgotPasswordController::class, 'method'])
        ->middleware('throttle:10,1') // prevent automated config-probing
        ->name('auth.password-reset.method');
    Route::post('/email', [Auth\ForgotPasswordController::class, 'requestEmailReset'])
        ->middleware(['throttle:password-reset-ip', 'throttle:password-reset-email', 'captcha'])
        ->name('auth.password-reset.email');
    Route::post('/reset', [Auth\ForgotPasswordController::class, 'resetWithToken'])
        ->middleware(['throttle:password-reset-ip', 'throttle:password-reset-email', 'captcha'])
        ->name('auth.password-reset.reset');
});

// Apply a throttle to authentication action endpoints, in addition to the
// captcha endpoints to slow down manual attack spammers even more. 🤷‍
//
// @see \Everest\Providers\RouteServiceProvider
Route::middleware(['throttle:authentication'])->group(function () {
    // Login endpoints.
    Route::post('/login', [Auth\LoginController::class, 'login'])->middleware('captcha');
    Route::post('/login/checkpoint', Auth\LoginCheckpointController::class)->name('auth.login-checkpoint');
    // Hands the pending confirmation token back to the checkpoint page. Scoped to
    // the session that started the login, which is what keeps the token out of
    // the URL for SSO callbacks (server redirects have no other way to pass it).
    Route::get('/login/checkpoint/pending', [Auth\LoginCheckpointController::class, 'pending'])
        ->name('auth.login-checkpoint.pending');

    Route::post('/register', [Auth\LoginController::class, 'register'])->middleware('captcha');
    Route::post('/check-username', [Auth\LoginController::class, 'checkUsername'])
        ->middleware('throttle:10,1') // 10 requests per minute to prevent enumeration
        ->name('auth.check-username');

    // Outbound leg + provider callback. The callback paths are registered with
    // the provider as redirect URIs — do not rename them.
    //
    // Both callbacks drop `guest`: a signed-in user reaches them when linking a
    // provider from their account settings.
    Route::post('/modules/discord', [Auth\Modules\DiscordLoginController::class, 'requestToken'])->middleware('captcha');
    Route::get('/modules/discord/authenticate', [Auth\Modules\DiscordLoginController::class, 'authenticate'])
        ->withoutMiddleware('guest')
        ->name('auth.modules.discord.authenticate');

    Route::post('/modules/google', [Auth\Modules\GoogleLoginController::class, 'requestToken'])->middleware('captcha');
    Route::get('/modules/google/authenticate', [Auth\Modules\GoogleLoginController::class, 'authenticate'])
        ->withoutMiddleware('guest')
        ->name('auth.modules.google.authenticate');

    // Provider-agnostic signup/link flow, driven by whatever identity the
    // callback stashed in the session. Shared by Discord and Google.
    Route::prefix('/sso')->group(function () {
        Route::get('/registration-data', [Auth\Modules\SsoRegistrationController::class, 'registrationData'])
            ->name('auth.sso.registration-data');
        Route::post('/check-username', [Auth\Modules\SsoRegistrationController::class, 'checkUsername'])
            ->middleware('throttle:10,1') // 10 per minute to blunt enumeration
            ->name('auth.sso.check-username');
        Route::post('/complete', [Auth\Modules\SsoRegistrationController::class, 'complete'])
            ->middleware('captcha')
            ->name('auth.sso.complete');
        Route::post('/link-intent', [Auth\Modules\SsoRegistrationController::class, 'linkIntent'])
            ->name('auth.sso.link-intent');
        Route::post('/cancel', [Auth\Modules\SsoRegistrationController::class, 'cancel'])
            ->name('auth.sso.cancel');
    });

    // Recovery code based password reset endpoint.
    Route::post('/password', [Auth\ForgotPasswordController::class, 'verify'])
        ->name('auth.post.forgot-password')
        ->middleware('captcha');
});

// Password reset routes. This endpoint is hit after going through
// the forgot password routes to acquire a token (or after an account
// is created).
Route::post('/password/reset', Auth\ResetPasswordController::class)
    ->middleware(['throttle:password-reset-ip', 'throttle:password-reset-email'])
    ->name('auth.reset-password');

Route::get('/email/verify/{id}/{hash}', Auth\VerifyEmailController::class)
    ->withoutMiddleware('guest')
    ->middleware('throttle:6,1') // prevent brute-force replay of captured links
    ->name('auth.verification.verify');

// Remove the guest middleware and apply the authenticated middleware to this endpoint,
// so it cannot be used unless you're already logged in.
Route::post('/logout', [Auth\LoginController::class, 'logout'])
    ->withoutMiddleware('guest')
    ->middleware('auth')
    ->name('auth.logout');

// Catch any other combinations of routes and pass them off to the React component.
Route::fallback([Base\IndexController::class, 'v2']);
