<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Everest\Models\UserOAuthAccount;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\RedirectResponse;
use Everest\Services\Auth\SocialIdentity;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

class DiscordLoginController extends AbstractSocialLoginController
{
    private const AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
    private const TOKEN_URL = 'https://discord.com/api/oauth2/token';
    private const IDENTITY_URL = 'https://discord.com/api/users/@me';

    public function __construct(private SettingsRepositoryInterface $settings)
    {
        parent::__construct();
    }

    protected function provider(): string
    {
        return UserOAuthAccount::PROVIDER_DISCORD;
    }

    protected function clientId(): ?string
    {
        return $this->settings->get('settings::modules:auth:discord:client_id', config('modules.auth.discord.client_id'));
    }

    protected function clientSecret(): ?string
    {
        return $this->settings->get('settings::modules:auth:discord:client_secret', config('modules.auth.discord.client_secret'));
    }

    protected function buildAuthorizeUrl(Request $request): string
    {
        return self::AUTHORIZE_URL . '?' . http_build_query([
            'client_id' => $this->clientId(),
            'redirect_uri' => route('auth.modules.discord.authenticate'),
            'response_type' => 'code',
            'scope' => 'identify email',
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

        // Discord reports a user-cancelled consent screen as ?error=access_denied.
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
            Log::warning('Discord SSO callback failed', ['exception' => $e->getMessage()]);

            return $this->failRedirect('provider_error');
        }

        if (!$identity) {
            return $this->failRedirect('provider_error');
        }

        return $this->resolveIdentity($request, $identity);
    }

    /**
     * Exchange the authorization code for the user's public profile.
     */
    private function fetchIdentity(string $code): ?SocialIdentity
    {
        $token = Http::asForm()->post(self::TOKEN_URL, [
            'client_id' => $this->clientId(),
            'client_secret' => $this->clientSecret(),
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => route('auth.modules.discord.authenticate'),
        ]);

        $accessToken = $token->json('access_token');
        if (!$accessToken) {
            return null;
        }

        $account = Http::withToken($accessToken)->get(self::IDENTITY_URL);

        $id = $account->json('id');
        if (!$id) {
            return null;
        }

        return new SocialIdentity(
            provider: $this->provider(),
            id: (string) $id,
            email: $account->json('email'),
            username: $account->json('username'),
            avatar: $account->json('avatar'),
        );
    }
}
