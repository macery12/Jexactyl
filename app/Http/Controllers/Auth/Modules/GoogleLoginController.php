<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Everest\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Everest\Models\UserOAuthAccount;
use Illuminate\Http\RedirectResponse;
use Laravel\Socialite\Facades\Socialite;
use Everest\Services\Auth\SocialIdentity;
use Laravel\Socialite\Two\GoogleProvider;

class GoogleLoginController extends AbstractSocialLoginController
{
    protected function provider(): string
    {
        return UserOAuthAccount::PROVIDER_GOOGLE;
    }

    protected function clientId(): ?string
    {
        return Setting::get('settings::modules:auth:google:client_id', config('modules.auth.google.client_id'));
    }

    protected function clientSecret(): ?string
    {
        return Setting::get('settings::modules:auth:google:client_secret', config('modules.auth.google.client_secret'));
    }

    /**
     * Socialite provider configured from the admin-managed credentials.
     *
     * Built per call rather than in the constructor: the settings are editable at
     * runtime, and a cached constructor read meant credential changes only took
     * effect after a config clear.
     */
    private function driver(): GoogleProvider
    {
        /** @var GoogleProvider $provider */
        $provider = Socialite::buildProvider(GoogleProvider::class, [
            'client_id' => $this->clientId(),
            'client_secret' => $this->clientSecret(),
            'redirect' => route('auth.modules.google.authenticate'),
        ]);

        return $provider;
    }

    /**
     * Socialite writes its own `state` into the session during redirect() and
     * validates it in user(), so the panel does not add a second one here — the
     * callback clears STATE_SESSION_KEY rather than checking it.
     */
    protected function buildAuthorizeUrl(Request $request): string
    {
        return $this->driver()->redirect()->getTargetUrl();
    }

    /**
     * Handle the OAuth2 callback.
     */
    public function authenticate(Request $request): RedirectResponse
    {
        if (!$this->moduleEnabled()) {
            return $this->failRedirect('module_disabled');
        }

        if ($request->filled('error')) {
            return $this->failRedirect($request->input('error') === 'access_denied' ? 'cancelled' : 'provider_error');
        }

        // Socialite owns state validation for this provider; drop our parallel
        // copy so it cannot be replayed against a later attempt.
        $request->session()->forget(self::STATE_SESSION_KEY);

        try {
            $account = $this->driver()->user();
        } catch (\Throwable $e) {
            // Covers InvalidStateException, a revoked code, and network failures.
            // All of these previously escaped as an unhandled 500.
            Log::warning('Google SSO callback failed', ['exception' => $e->getMessage()]);

            return $this->failRedirect('provider_error');
        }

        if (!$account->getId()) {
            return $this->failRedirect('provider_error');
        }

        $identity = new SocialIdentity(
            provider: $this->provider(),
            id: (string) $account->getId(),
            email: $account->getEmail(),
            username: $account->getNickname() ?: $account->getName(),
            avatar: $account->getAvatar(),
        );

        return $this->resolveIdentity($request, $identity);
    }
}
