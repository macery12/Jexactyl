<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Everest\Models\User;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Models\UserOAuthAccount;
use Everest\Exceptions\DisplayException;
use Everest\Services\Auth\SocialIdentity;
use Everest\Http\Controllers\Auth\AbstractLoginController;
use Everest\Http\Requests\Auth\CompleteSsoRegistrationRequest;

/**
 * Serves the pages that run after an OAuth callback has verified an identity for
 * which no panel account exists: the link-or-create choice, and the signup form.
 *
 * Provider-agnostic by design — Discord and Google share one set of endpoints
 * and one set of pages, driven by whatever the callback left in the session.
 */
class SsoRegistrationController extends AbstractLoginController
{
    /**
     * The pending SSO identity, for the link-choice and signup pages.
     */
    public function registrationData(Request $request): JsonResponse
    {
        $identity = $this->pendingIdentity($request);

        if (!$identity) {
            return new JsonResponse(['error' => 'No pending SSO registration was found.'], 404);
        }

        // Whether an account already owns this address decides which option the
        // link-choice page leads with. Only ever reported for the address the
        // provider just verified, so it discloses nothing the caller did not
        // already control.
        $emailTaken = $identity->email !== null
            && User::query()->where('email', $identity->email)->exists();

        return new JsonResponse([
            'provider' => $identity->provider,
            'provider_label' => UserOAuthAccount::label($identity->provider),
            'username' => $identity->username,
            'email' => $identity->email,
            'provider_user_id' => $identity->id,
            'email_taken' => $emailTaken,
            'registration_enabled' => (bool) config('modules.auth.registration.enabled', false),
        ]);
    }

    /**
     * Live username availability for the SSO signup form.
     */
    public function checkUsername(Request $request): JsonResponse
    {
        $username = $request->input('username');

        if (!$username) {
            return new JsonResponse(['available' => false, 'message' => 'Username is required'], 400);
        }

        // Match the email signup checker's timing jitter so this endpoint is no
        // more useful for enumeration than that one.
        usleep(random_int(50000, 150000));

        $exists = User::query()->where('username', $username)->exists();

        return new JsonResponse([
            'available' => !$exists,
            'message' => $exists ? 'This username is already taken' : 'Username is available',
        ]);
    }

    /**
     * Create the panel account for a verified SSO identity.
     *
     * @throws DisplayException
     */
    public function complete(CompleteSsoRegistrationRequest $request): JsonResponse
    {
        $identity = $this->pendingIdentity($request);

        if (!$identity) {
            throw new DisplayException('Your sign-in session expired. Please start again.');
        }

        if (!(bool) config('modules.auth.' . $identity->provider . '.enabled', false)) {
            throw new DisplayException(UserOAuthAccount::label($identity->provider) . ' authentication is currently disabled.');
        }

        if (!$identity->email) {
            throw new DisplayException('Your ' . UserOAuthAccount::label($identity->provider) . ' account has no verified email address, which is required to create a panel account.');
        }

        // The address may have been claimed between the callback and this submit.
        if (User::query()->where('email', $identity->email)->exists()) {
            throw new DisplayException('An account already exists for this email address. Sign in and link ' . UserOAuthAccount::label($identity->provider) . ' from your account settings instead.');
        }

        $user = $this->createAccountUnchecked([
            'username' => $request->input('username'),
            'email' => $identity->email,
            'password' => $request->input('password'),
        ]);

        $this->storeOAuthLink($user, $identity);

        Activity::event('auth:sso.register')
            ->subject($user)
            ->property('provider', $identity->provider)
            ->log();

        $request->session()->forget(AbstractSocialLoginController::REGISTRATION_SESSION_KEY);

        // jGuard holds the account — no session, the SPA shows the pending screen.
        if ($user->isPending()) {
            return $this->sendPendingApprovalResponse($user);
        }

        return $this->sendLoginResponse($user, $request);
    }

    /**
     * Record that the user wants to attach this identity to an account they will
     * now sign into. The link itself is applied by the login response, once the
     * password (and 2FA) challenge has actually been met.
     *
     * @throws DisplayException
     */
    public function linkIntent(Request $request): JsonResponse
    {
        $identity = $this->pendingIdentity($request);

        if (!$identity) {
            throw new DisplayException('Your sign-in session expired. Please start again.');
        }

        $request->session()->put(AbstractSocialLoginController::LINK_AFTER_LOGIN_SESSION_KEY, true);

        return new JsonResponse([
            'data' => [
                'provider' => $identity->provider,
                'email' => $identity->email,
            ],
        ]);
    }

    /**
     * Abandon a pending SSO registration (the "cancel" path on both pages).
     */
    public function cancel(Request $request): JsonResponse
    {
        $request->session()->forget([
            AbstractSocialLoginController::REGISTRATION_SESSION_KEY,
            AbstractSocialLoginController::LINK_AFTER_LOGIN_SESSION_KEY,
            AbstractSocialLoginController::LINK_USER_SESSION_KEY,
        ]);

        return new JsonResponse([], 204);
    }

    /**
     * Read and validate the identity the callback stashed in the session.
     */
    private function pendingIdentity(Request $request): ?SocialIdentity
    {
        $stored = $request->session()->get(AbstractSocialLoginController::REGISTRATION_SESSION_KEY);

        if (!is_array($stored)) {
            return null;
        }

        $identity = SocialIdentity::fromArray($stored);

        if ($identity->id === '' || !in_array($identity->provider, UserOAuthAccount::PROVIDERS, true)) {
            return null;
        }

        return $identity;
    }
}
