<?php

namespace Everest\Http\Controllers\Auth;

use Carbon\Carbon;
use Everest\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Everest\Models\JGuardEntry;
use Illuminate\Auth\AuthManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Auth\Events\Failed;
use Illuminate\Container\Container;
use Illuminate\Support\Facades\Log;
use Everest\Events\Auth\DirectLogin;
use Everest\Models\UserOAuthAccount;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Event;
use Everest\Exceptions\DisplayException;
use Everest\Http\Controllers\Controller;
use Everest\Services\Auth\SocialIdentity;
use Everest\Services\Auth\UserSessionService;
use Illuminate\Contracts\Auth\Authenticatable;
use Everest\Services\Users\UserCreationService;
use Everest\Services\Webhooks\WebhookEventService;
use Illuminate\Foundation\Auth\AuthenticatesUsers;
use Everest\Exceptions\Http\Auth\AccountSuspendedException;
use Everest\Exceptions\Http\Auth\AccountPendingApprovalException;

abstract class AbstractLoginController extends Controller
{
    use AuthenticatesUsers;

    protected AuthManager $auth;
    protected UserCreationService $creation;
    protected UserSessionService $sessionService;

    /**
     * Session key holding the "remember me" choice made at the password step, so
     * it survives the separate request that answers the 2FA checkpoint.
     */
    protected const REMEMBER_SESSION_KEY = 'auth_remember_login';

    /**
     * Lockout time, in minutes, for failed login requests.
     *
     * Named to match ThrottlesLogins::decayMinutes(), which resolves the value
     * through property_exists(). The previous name ($lockoutTime) was never read
     * by anything, so the configured lockout was silently ignored in favour of
     * the trait's 1-minute default.
     */
    protected int $decayMinutes;

    /**
     * After how many attempts should logins be throttled and locked.
     *
     * Likewise named for ThrottlesLogins::maxAttempts(); the old
     * $maxLoginAttempts was dead and the real limit was the trait's default of 5.
     */
    protected int $maxAttempts;

    /**
     * Where to redirect users after login / registration.
     */
    protected string $redirectTo = '/';

    /**
     * LoginController constructor.
     */
    public function __construct()
    {
        $this->decayMinutes = (int) config('auth.lockout.time');
        $this->maxAttempts = (int) config('modules.auth.security.attempts');
        $this->auth = Container::getInstance()->make(AuthManager::class);
        $this->creation = Container::getInstance()->make(UserCreationService::class);
        $this->sessionService = Container::getInstance()->make(UserSessionService::class);
    }

    /**
     * The request field holding the login identifier.
     *
     * AuthenticatesUsers defaults this to 'email', but every login path here
     * reads `user` (which accepts a username or an email). ThrottlesLogins builds
     * its throttle key from $request->input($this->username()), so leaving the
     * default in place made every key '|<ip>' — one shared bucket per IP for all
     * accounts, which any single successful login then cleared.
     */
    public function username(): string
    {
        return 'user';
    }

    /**
     * Get the failed login response instance.
     *
     * SECURITY: Uses a generic error message to prevent account enumeration.
     * The same message is returned whether the username or password is incorrect.
     *
     * @return never
     *
     * @throws DisplayException
     */
    protected function sendFailedLoginResponse(Request $request, ?Authenticatable $user = null, ?string $message = null)
    {
        $this->incrementLoginAttempts($request);

        // Fire failed login event if user was found
        if ($user) {
            $this->fireFailedLoginEvent($user, [
                $this->getField($request->input('user')) => $request->input('user'),
            ]);
        }

        if ($request->route()->named('auth.login-checkpoint')) {
            throw new DisplayException($message ?? trans('auth.two_factor.checkpoint_failed'));
        }

        // Generic error message - don't reveal if user exists or password is wrong
        throw new DisplayException(trans('auth.failed'));
    }

    /**
     * Stash the pending-2FA state in the session and return the confirmation
     * token that must be replayed to the checkpoint endpoint.
     *
     * Shared by the password login (which returns the token as JSON) and both
     * SSO callbacks (which redirect). Previously each SSO controller rolled its
     * own copy and sent the user to `/auth/login?checkpoint=<token>`, a query
     * string nothing on the frontend has ever read — so every SSO user with 2FA
     * enabled was silently bounced back to an empty login form.
     */
    protected function issueTwoFactorChallenge(Request $request, User $user, bool $remember = false): string
    {
        $request->session()->put('auth_confirmation_token', [
            'user_id' => $user->id,
            'token_value' => $token = Str::random(64),
            'expires_at' => CarbonImmutable::now()->addMinutes(5),
        ]);

        // Kept out of the token payload so it cannot be replayed by a client that
        // somehow holds the token: the choice was made at the password step and is
        // only ever read back from this same session.
        $request->session()->put(self::REMEMBER_SESSION_KEY, $remember);

        return $token;
    }

    /**
     * The "remember me" choice recorded at the password step of this login.
     *
     * A non-destructive read: a mistyped TOTP code must not silently downgrade
     * the choice on the retry. sendLoginResponse() clears the key once the login
     * actually completes.
     */
    protected function rememberChoice(Request $request): bool
    {
        return (bool) $request->session()->get(self::REMEMBER_SESSION_KEY, false);
    }

    /**
     * Send a user arriving through an SSO callback to the 2FA checkpoint.
     *
     * The token deliberately stays out of the URL — the checkpoint page reads it
     * back from the session over `GET /auth/login/checkpoint/pending`, which keeps
     * it out of browser history, `Referer` headers and access logs.
     */
    protected function redirectToTwoFactorChallenge(Request $request, User $user): RedirectResponse
    {
        $this->issueTwoFactorChallenge($request, $user);

        Activity::event('auth:checkpoint')->withRequestMetadata()->subject($user)->log();

        return redirect('/auth/login/checkpoint');
    }

    /**
     * Attach an SSO identity the user opted to link before signing in.
     *
     * Proving ownership of the panel account with a password (and 2FA, if
     * enabled) is what authorises the link — matching email addresses alone is
     * not enough, since that would let whoever controls an address claim the
     * account using it.
     */
    protected function completePendingOAuthLink(User $user, Request $request): void
    {
        if (!$request->session()->pull(Modules\AbstractSocialLoginController::LINK_AFTER_LOGIN_SESSION_KEY)) {
            return;
        }

        $stored = $request->session()->pull(Modules\AbstractSocialLoginController::REGISTRATION_SESSION_KEY);
        if (!is_array($stored)) {
            return;
        }

        $identity = SocialIdentity::fromArray($stored);
        if ($identity->provider === '' || $identity->id === '') {
            return;
        }

        // Refuse if another account already owns this provider identity.
        if ($this->oauthIdentityClaimedByOther($identity, $user)) {
            return;
        }

        $this->storeOAuthLink($user, $identity);

        Activity::event('user:sso.link')
            ->subject($user)
            ->property('provider', $identity->provider)
            ->log();
    }

    /**
     * Whether this provider identity is already attached to a different account.
     */
    protected function oauthIdentityClaimedByOther(SocialIdentity $identity, User $user): bool
    {
        return UserOAuthAccount::query()
            ->where('provider', $identity->provider)
            ->where('provider_user_id', $identity->id)
            ->where('user_id', '!=', $user->id)
            ->exists();
    }

    /**
     * Persist (or refresh) the link row for a user and provider.
     */
    protected function storeOAuthLink(User $user, SocialIdentity $identity): UserOAuthAccount
    {
        /** @var UserOAuthAccount $account */
        $account = UserOAuthAccount::query()->updateOrCreate(
            [
                'user_id' => $user->id,
                'provider' => $identity->provider,
            ],
            [
                'provider_user_id' => $identity->id,
                'provider_username' => $identity->username,
                'provider_email' => $identity->email,
                'provider_avatar' => $identity->avatar,
            ]
        );

        // Keep users.external_id in step for Discord: it predates this table and
        // is still what other parts of the panel read for a Discord id.
        if ($identity->provider === UserOAuthAccount::PROVIDER_DISCORD && $user->external_id !== $identity->id) {
            $user->update(['external_id' => $identity->id]);
        }

        return $account;
    }

    /**
     * Refuse to issue a session to an account that is not usable yet.
     *
     * This sits in front of every login path (password, 2FA checkpoint and both
     * SSO callbacks) rather than in middleware, because middleware only ran on
     * the client API — a pending or suspended user could still authenticate,
     * hold a real session and reach everything outside /api/client.
     *
     * @throws AccountPendingApprovalException
     * @throws AccountSuspendedException
     */
    protected function assertAccountUsable(User $user): void
    {
        if ($user->isSuspended()) {
            throw new AccountSuspendedException();
        }

        if (!$user->isPending()) {
            return;
        }

        $entry = JGuardEntry::query()
            ->where('user_id', $user->id)
            ->where('status', JGuardEntry::STATUS_PENDING)
            ->first();

        // No pending entry — the state is stale (jGuard was turned off, or the
        // entry was cleaned up). Release the account rather than locking it out.
        if (!$entry) {
            $user->update(['state' => null]);

            return;
        }

        // 'delayed' accounts activate on their own once the delay elapses. The
        // scheduled command normally does this; do it here too so a login that
        // lands between runs is not turned away.
        if ($entry->approval_mode === JGuardEntry::MODE_DELAYED && $entry->isExpired()) {
            $entry->update(['status' => JGuardEntry::STATUS_APPROVED]);
            $user->update(['state' => null]);

            return;
        }

        throw AccountPendingApprovalException::withConfiguredMessage();
    }

    /**
     * The response returned in place of a session when jGuard is holding a newly
     * created account. `complete: false` with no confirmation token is what tells
     * the SPA to show the "awaiting approval" screen.
     */
    protected function sendPendingApprovalResponse(User $user): JsonResponse
    {
        $data = [
            'complete' => false,
            'user_state' => 'pending',
            'pending_message' => AccountPendingApprovalException::withConfiguredMessage()->getMessage(),
        ];

        // The one-time recovery code is generated at creation and shown exactly
        // once. A pending user never reaches the post-login reveal, so surface it
        // here instead of silently discarding it.
        if (!empty($user->recoveryCodePlain)) {
            $data['recovery_code'] = $user->recoveryCodePlain;
        }

        return new JsonResponse(['data' => $data]);
    }

    /**
     * Send the response after the user was authenticated.
     *
     * @throws AccountPendingApprovalException
     * @throws AccountSuspendedException
     */
    protected function sendLoginResponse(User $user, Request $request, bool $remember = false): JsonResponse
    {
        $this->assertAccountUsable($user);

        // Consume a pending "sign in to link" before the session is regenerated,
        // so an SSO identity the user chose to attach survives the 2FA step too.
        $this->completePendingOAuthLink($user, $request);

        $request->session()->remove('auth_confirmation_token');
        $request->session()->forget(self::REMEMBER_SESSION_KEY);
        $request->session()->regenerate();

        $this->clearLoginAttempts($request);

        $guard = $this->auth->guard();

        // Remember was previously hardcoded to true, planting a recaller cookie
        // valid for SessionGuard's default 576000 minutes (400 days) in every
        // browser whether the user asked for it or not. It is now opt-in and
        // bounded by config.
        if ($remember && method_exists($guard, 'setRememberDuration')) {
            $guard->setRememberDuration((int) config('auth.remember.duration'));
        }

        $guard->login($user, $remember);

        $deviceId = $request->cookie(UserSessionService::DEVICE_COOKIE);
        $shouldSetCookie = $deviceId === null;

        $trackedSession = $this->sessionService->recordLogin($user, $request->session()->getId(), $deviceId);
        Log::info('AbstractLoginController: login response generated', [
            'user_id' => $user->id,
            'session_db_id' => $trackedSession->id,
            'set_cookie' => $shouldSetCookie,
        ]);

        Event::dispatch(new DirectLogin($user, true));

        $responseData = [
            'complete' => true,
            'intended' => $this->redirectPath(),
            'user' => $user->toReactObject(),
        ];

        // Surface the freshly generated offline recovery code exactly once, on the
        // registration login response. It is null on every ordinary login, so this
        // key is only ever present immediately after account creation.
        if (!empty($user->recoveryCodePlain)) {
            $responseData['recovery_code'] = $user->recoveryCodePlain;
        }

        $response = new JsonResponse([
            'data' => $responseData,
        ]);

        if ($shouldSetCookie && $deviceId) {
            $response->cookie(
                cookie(
                    UserSessionService::DEVICE_COOKIE,
                    $deviceId,
                    60 * 24 * 180,
                    config('session.path', '/'),
                    config('session.domain'),
                    config('session.secure'),
                    true,
                    false,
                    config('session.same_site')
                )
            );
        }

        return $response;
    }

    /**
     * Create an account on the Panel if the details do not exist.
     * When jGuard is enabled, the account is created in a pending state
     * until an admin approves it (manual mode) or the delay elapses (delayed mode).
     */
    public function createAccount(array $data): User
    {
        $enabled = config('modules.auth.registration.enabled') ?? false;

        if (!$enabled) {
            throw new DisplayException('User signup is disabled at this time.');
        }

        if (User::where('username', $data['username'])->exists()) {
            throw new DisplayException('This username is already in use by another user.');
        }

        return $this->createAccountUnchecked($data);
    }

    /**
     * Create an account without consulting the registration toggle, applying the
     * jGuard hold if one is configured.
     *
     * SSO signup uses this: an admin who enables Discord/Google login has opted
     * into accounts being created through it, independently of whether the email
     * signup form is open. jGuard still applies — it is the approval gate, and
     * SSO is exactly the path it exists to screen.
     */
    protected function createAccountUnchecked(array $data): User
    {
        $user = $this->creation->handle(array_merge($data, [
            'state' => $this->jguardHoldsNewAccounts() ? 'pending' : null,
        ]));

        $this->applyJGuardHold($user);

        return $user;
    }

    /**
     * Whether jGuard is configured to hold new registrations for approval.
     */
    protected function jguardHoldsNewAccounts(): bool
    {
        if (!(config('modules.auth.jguard.enabled') ?? false)) {
            return false;
        }

        return config('modules.auth.jguard.approval_mode', JGuardEntry::MODE_MANUAL) !== JGuardEntry::MODE_IMMEDIATE;
    }

    /**
     * Record the jGuard entry for a freshly created account and notify staff.
     * No-op when jGuard is off or set to immediate approval.
     */
    protected function applyJGuardHold(User $user): void
    {
        if (!$this->jguardHoldsNewAccounts()) {
            return;
        }

        $approvalMode = config('modules.auth.jguard.approval_mode', JGuardEntry::MODE_MANUAL);
        $delay = (int) (config('modules.auth.jguard.delay') ?? 60);

        $expiresAt = $approvalMode === JGuardEntry::MODE_DELAYED
            ? Carbon::now()->addMinutes($delay)
            : null;

        JGuardEntry::create([
            'user_id' => $user->id,
            'status' => JGuardEntry::STATUS_PENDING,
            'approval_mode' => $approvalMode,
            'expires_at' => $expiresAt,
        ]);

        Container::getInstance()->make(WebhookEventService::class)
            ->notifyJGuardRegistered($user, $approvalMode, $expiresAt);
    }

    /**
     * Determine if the user is logging in using an email or username.
     */
    protected function getField(?string $input = null): string
    {
        return ($input && str_contains($input, '@')) ? 'email' : 'username';
    }

    /**
     * Fire a failed login event.
     */
    protected function fireFailedLoginEvent(?Authenticatable $user = null, array $credentials = [])
    {
        Event::dispatch(new Failed('auth', $user, $credentials));
    }
}
