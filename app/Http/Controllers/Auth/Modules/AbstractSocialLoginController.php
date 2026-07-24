<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Everest\Models\User;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Models\UserOAuthAccount;
use Illuminate\Http\RedirectResponse;
use Everest\Exceptions\DisplayException;
use Everest\Services\Auth\SocialIdentity;
use Everest\Http\Controllers\Auth\AbstractLoginController;

/**
 * Shared plumbing for the OAuth login modules.
 *
 * Discord and Google previously each carried their own copy of callback
 * handling, and the copies had drifted: Discord resolved accounts by a stored
 * provider id while Google matched on email alone, only Discord offered a
 * signup flow, and neither checked jGuard. Everything provider-independent now
 * lives here so the two callbacks differ only in how they fetch an identity.
 */
abstract class AbstractSocialLoginController extends AbstractLoginController
{
    /**
     * Session key holding the identity of an SSO user who has authenticated with
     * the provider but does not yet have a panel account.
     */
    public const REGISTRATION_SESSION_KEY = 'sso_registration_data';

    /**
     * Session key set when an already-authenticated user starts a link flow from
     * their account settings.
     */
    public const LINK_USER_SESSION_KEY = 'sso_link_user_id';

    /**
     * Session key set when a guest chose "sign in to link" on the link-choice
     * page. Consumed by AbstractLoginController::sendLoginResponse once the
     * password (and 2FA) challenge has been satisfied.
     */
    public const LINK_AFTER_LOGIN_SESSION_KEY = 'sso_link_after_login';

    /**
     * Session key holding the OAuth `state` value for CSRF protection.
     */
    public const STATE_SESSION_KEY = 'sso_oauth_state';

    /**
     * The provider this controller authenticates against.
     */
    abstract protected function provider(): string;

    /**
     * Whether the module is switched on. Callbacks refuse to run when it is not,
     * so disabling a module in the admin panel takes effect immediately even if
     * someone replays a stale authorize URL.
     */
    protected function moduleEnabled(): bool
    {
        return (bool) config('modules.auth.' . $this->provider() . '.enabled', false);
    }

    /**
     * Generate and remember an OAuth `state` value for the outbound redirect.
     */
    protected function issueState(Request $request): string
    {
        $request->session()->put(self::STATE_SESSION_KEY, $state = Str::random(40));

        return $state;
    }

    /**
     * Verify the `state` echoed back by the provider. Pulled rather than read so
     * a value can never be replayed.
     */
    protected function stateIsValid(Request $request): bool
    {
        $expected = $request->session()->pull(self::STATE_SESSION_KEY);
        $returned = $request->input('state');

        return is_string($expected)
            && is_string($returned)
            && $expected !== ''
            && hash_equals($expected, $returned);
    }

    /**
     * Resolve an authenticated provider identity onto a panel session.
     *
     * Order matters: an explicit link flow wins, then an existing link, then an
     * account that already owns the email address (which is offered as a link
     * rather than silently merged), and finally signup.
     */
    protected function resolveIdentity(Request $request, SocialIdentity $identity): RedirectResponse
    {
        // Linking to an account that is already signed in.
        $linkUserId = $request->session()->pull(self::LINK_USER_SESSION_KEY);
        if ($linkUserId) {
            return $this->linkToExistingUser($identity, (int) $linkUserId);
        }

        $existing = UserOAuthAccount::query()
            ->where('provider', $identity->provider)
            ->where('provider_user_id', $identity->id)
            ->first();

        if ($existing?->user) {
            // Refresh the cached profile so the account page does not show a
            // username the user changed on the provider months ago.
            $existing->update([
                'provider_username' => $identity->username,
                'provider_email' => $identity->email,
                'provider_avatar' => $identity->avatar,
            ]);

            return $this->loginAndRedirect($request, $existing->user);
        }

        // The provider account is unknown to us. Stash it for the signup/link
        // choice pages; nothing is created until the user picks an option.
        $request->session()->put(self::REGISTRATION_SESSION_KEY, $identity->toArray());

        return redirect('/auth/sso/link-choice');
    }

    /**
     * Complete a login for a user resolved from an SSO identity, honouring 2FA
     * and the account-state gate.
     */
    protected function loginAndRedirect(Request $request, User $user): RedirectResponse
    {
        try {
            $this->assertAccountUsable($user);
        } catch (\Throwable $e) {
            // Suspended or jGuard-pending. Surface the reason on the login page
            // rather than letting a 403 escape as an error screen.
            return $this->failRedirect('account_unavailable', $e->getMessage());
        }

        if ($user->use_totp) {
            return $this->redirectToTwoFactorChallenge($request, $user);
        }

        $loginResponse = $this->sendLoginResponse($user, $request);
        $redirect = redirect($this->redirectPath());

        // sendLoginResponse queues the long-lived device cookie on its own
        // JsonResponse; carry it over so the redirect actually sets it.
        foreach ($loginResponse->headers->getCookies() as $cookie) {
            $redirect->headers->setCookie($cookie);
        }

        return $redirect;
    }

    /**
     * Attach a provider identity to an existing, already-authenticated account.
     */
    protected function linkToExistingUser(SocialIdentity $identity, int $userId): RedirectResponse
    {
        $user = User::find($userId);

        if (!$user) {
            return $this->failRedirect('link_session_expired');
        }

        if ($this->oauthIdentityClaimedByOther($identity, $user)) {
            return redirect('/settings?sso_error=already_linked');
        }

        $this->storeOAuthLink($user, $identity);

        Activity::event('user:sso.link')
            ->subject($user)
            ->property('provider', $identity->provider)
            ->log();

        return redirect('/settings?sso_linked=' . $identity->provider);
    }

    /**
     * Abandon the flow and report why on the login page. `sso_error` is a stable
     * code the SPA maps onto a localized message; the optional detail carries
     * server-authored text (a jGuard pending message, for instance).
     */
    protected function failRedirect(string $code, ?string $detail = null): RedirectResponse
    {
        $query = ['sso_error' => $code];
        if ($detail !== null && $detail !== '') {
            $query['sso_error_detail'] = $detail;
        }

        return redirect('/auth/login?' . http_build_query($query));
    }

    /**
     * Guard the outbound leg: module enabled, credentials configured and the
     * caller is not being throttled.
     *
     * @throws DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    protected function assertCanStartFlow(Request $request): void
    {
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            $this->sendLockoutResponse($request);
        }

        if (!$this->moduleEnabled()) {
            throw new DisplayException(UserOAuthAccount::label($this->provider()) . ' authentication is not enabled on this panel.');
        }

        if (!$this->clientId() || !$this->clientSecret()) {
            throw new DisplayException(UserOAuthAccount::label($this->provider()) . ' authentication is not fully configured. Please contact an administrator.');
        }
    }

    abstract protected function clientId(): ?string;

    abstract protected function clientSecret(): ?string;

    /**
     * Build the provider's authorize URL and record the matching `state`.
     */
    abstract protected function buildAuthorizeUrl(Request $request): string;

    /**
     * Begin a sign-in flow. Returns the URL for the browser to follow.
     *
     * @throws DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    public function requestToken(Request $request): string
    {
        $this->assertCanStartFlow($request);

        return $this->buildAuthorizeUrl($request);
    }

    /**
     * Begin a link flow for a user who is already signed in. The callback picks
     * the link path up from LINK_USER_SESSION_KEY.
     *
     * @throws DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    public function requestLinkToken(Request $request): JsonResponse
    {
        $this->assertCanStartFlow($request);

        $request->session()->put(self::LINK_USER_SESSION_KEY, $request->user()->id);

        return new JsonResponse(['url' => $this->buildAuthorizeUrl($request)]);
    }
}
