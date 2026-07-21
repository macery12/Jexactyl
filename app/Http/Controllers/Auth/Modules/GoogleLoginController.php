<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Everest\Models\User;
use Illuminate\Support\Str;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Laravel\Socialite\Facades\Socialite;
use Everest\Services\Users\UserCreationService;
use Everest\Http\Controllers\Auth\AbstractLoginController;
use Everest\Models\Setting;

class GoogleLoginController extends AbstractLoginController
{
    /**
     * GoogleLoginController constructor.
     */
    public function __construct(
        private UserCreationService $creationService,
    ) {
        parent::__construct();

        $this->config = [
            'redirect' => route('auth.modules.google.authenticate'),
            'client_id' => Setting::get('settings::modules:auth:google:client_id', config('modules.auth.google.client_id')),
            'client_secret' => Setting::get('settings::modules:auth:google:client_secret', config('modules.auth.google.client_secret')),
        ];
    }

    /**
     * Get the user's Google details in order to access the account.
     *
     * @throws \Everest\Exceptions\DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    public function requestToken(Request $request): string
    {
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            $this->sendLockoutResponse($request);
        }

        return Socialite::buildProvider(\Laravel\Socialite\Two\GoogleProvider::class, $this->config)
            ->redirect()
            ->getTargetUrl();
    }

    /**
     * Authenticate with the Google OAuth2 service.
     */
    public function authenticate(Request $request): RedirectResponse
    {
        $response = Socialite::buildProvider(\Laravel\Socialite\Two\GoogleProvider::class, $this->config)->user();

        if (User::where('email', $response->email)->exists()) {
            $user = User::where('email', $response->email)->first();

            // If user has 2FA enabled, redirect to login for TOTP verification
            if ($user->use_totp) {
                return $this->redirectToTwoFactorChallenge($request, $user);
            }

            $loginResponse = $this->sendLoginResponse($user, $request);
            $redirect = redirect('/');

            foreach ($loginResponse->headers->getCookies() as $cookie) {
                $redirect->headers->setCookie($cookie);
            }

            return $redirect;
        } else {
            $user = $this->createAccount(['email' => $response->email, 'username' => 'null_user_' . $this->randStr(16)]);

            $loginResponse = $this->sendLoginResponse($user, $request);
            $redirect = redirect('/settings');

            foreach ($loginResponse->headers->getCookies() as $cookie) {
                $redirect->headers->setCookie($cookie);
            }

            return $redirect;
        }

        return redirect()->route('auth.login');
    }

    /**
     * Redirect a user with 2FA enabled to the TOTP verification challenge.
     * Stores the pending authentication in session for the checkpoint flow.
     */
    protected function redirectToTwoFactorChallenge(Request $request, User $user): RedirectResponse
    {
        $token = Str::random(64);

        $request->session()->put('auth_confirmation_token', [
            'user_id' => $user->id,
            'token_value' => $token,
            'expires_at' => CarbonImmutable::now()->addMinutes(5),
        ]);

        return redirect('/auth/login?checkpoint=' . $token);
    }

    /**
     * Create a random string we can use for a temporary username.
     */
    public function randStr(int $length = 10): string
    {
        return substr(str_shuffle(str_repeat($x = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', ceil($length / strlen($x)))), 1, $length);
    }
}
