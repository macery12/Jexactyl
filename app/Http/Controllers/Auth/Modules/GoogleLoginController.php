<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Everest\Models\Setting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Everest\Models\UserOAuthAccount;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\RedirectResponse;
use Everest\Services\Auth\SocialIdentity;

class GoogleLoginController extends AbstractSocialLoginController
{
    private const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    private const IDENTITY_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

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

    protected function buildAuthorizeUrl(Request $request): string
    {
        return self::AUTHORIZE_URL . '?' . http_build_query([
            'client_id' => $this->clientId(),
            'redirect_uri' => route('auth.modules.google.authenticate'),
            'response_type' => 'code',
            'scope' => 'openid profile email',
            'state' => $this->issueState($request),
        ]);
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

        if (!$this->stateIsValid($request)) {
            return $this->failRedirect('invalid_state');
        }

        if (!$request->filled('code')) {
            return $this->failRedirect('missing_code');
        }

        try {
            $identity = $this->fetchIdentity($request->input('code'));
        } catch (\Throwable $e) {
            Log::warning('Google SSO callback failed', ['exception' => $e->getMessage()]);

            return $this->failRedirect('provider_error');
        }

        if (!$identity) {
            return $this->failRedirect('provider_error');
        }

        return $this->resolveIdentity($request, $identity);
    }

    /**
     * Exchange the authorization code for the OpenID Connect user profile.
     */
    private function fetchIdentity(string $code): ?SocialIdentity
    {
        $token = Http::asForm()->post(self::TOKEN_URL, [
            'client_id' => $this->clientId(),
            'client_secret' => $this->clientSecret(),
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => route('auth.modules.google.authenticate'),
        ]);

        $accessToken = $token->successful() ? $token->json('access_token') : null;
        if (!is_string($accessToken) || $accessToken === '') {
            return null;
        }

        $account = Http::withToken($accessToken)->acceptJson()->get(self::IDENTITY_URL);
        $id = $account->successful() ? $account->json('sub') : null;
        if (!is_string($id) || $id === '') {
            return null;
        }

        $email = $account->json('email');
        $username = $account->json('name');
        $avatar = $account->json('picture');

        return new SocialIdentity(
            provider: $this->provider(),
            id: $id,
            email: is_string($email) ? $email : null,
            username: is_string($username) ? $username : null,
            avatar: is_string($avatar) ? $avatar : null,
        );
    }
}
