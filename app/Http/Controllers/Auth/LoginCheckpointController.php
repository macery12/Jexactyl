<?php

namespace Everest\Http\Controllers\Auth;

use Everest\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Event;
use Everest\Events\Auth\ProvidedAuthenticationToken;
use Everest\Http\Requests\Auth\LoginCheckpointRequest;
use Everest\Services\Users\TwoFactorVerificationService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Contracts\Validation\Factory as ValidationFactory;

class LoginCheckpointController extends AbstractLoginController
{
    private const TOKEN_EXPIRED_MESSAGE = 'The authentication token provided has expired, please refresh the page and try again.';

    /**
     * LoginCheckpointController constructor.
     */
    public function __construct(
        private TwoFactorVerificationService $verification,
        private ValidationFactory $validation,
    ) {
        parent::__construct();
    }

    /**
     * Handle a login where the user is required to provide a TOTP authentication
     * token. Once a user has reached this stage it is assumed that they have already
     * provided a valid username and password.
     *
     * @throws \PragmaRX\Google2FA\Exceptions\IncompatibleWithGoogleAuthenticatorException
     * @throws \PragmaRX\Google2FA\Exceptions\InvalidCharactersException
     * @throws \PragmaRX\Google2FA\Exceptions\SecretKeyTooShortException
     * @throws \Exception
     * @throws \Illuminate\Validation\ValidationException
     */
    public function __invoke(LoginCheckpointRequest $request): JsonResponse
    {
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            $this->sendLockoutResponse($request);
        }

        $details = $request->session()->get('auth_confirmation_token');
        if (!$this->hasValidSessionData($details)) {
            $this->sendFailedLoginResponse($request, null, self::TOKEN_EXPIRED_MESSAGE);
        }

        if (!hash_equals($request->input('confirmation_token') ?? '', $details['token_value'])) {
            $this->sendFailedLoginResponse($request);
        }

        try {
            /** @var User $user */
            $user = User::query()->findOrFail($details['user_id']);
        } catch (ModelNotFoundException) {
            $this->sendFailedLoginResponse($request, null, self::TOKEN_EXPIRED_MESSAGE);
        }

        // Recovery tokens go through a slightly different pathway for usage.
        if (!is_null($recoveryToken = $request->input('recovery_token'))) {
            if ($this->verification->consumeRecoveryToken($user, $recoveryToken)) {
                Event::dispatch(new ProvidedAuthenticationToken($user, true));

                return $this->sendLoginResponse($user, $request);
            }
        } elseif ($this->verification->isValidTotp($user, $request->input('authentication_code') ?? '')) {
            Event::dispatch(new ProvidedAuthenticationToken($user));

            return $this->sendLoginResponse($user, $request);
        }

        $this->sendFailedLoginResponse($request, $user, !empty($recoveryToken) ? 'The recovery token provided is not valid.' : null);
    }

    /**
     * Hand the pending confirmation token back to the checkpoint page.
     *
     * Only the session that started the login can read it, which makes this
     * equivalent in reach to the session cookie itself while keeping the token
     * out of the URL. SSO callbacks are server-side redirects and have no other
     * way to pass it — the old approach put it in a query string that reached
     * browser history, `Referer` headers and access logs.
     */
    public function pending(Request $request): JsonResponse
    {
        $details = $request->session()->get('auth_confirmation_token');

        if (!$this->hasValidSessionData($details)) {
            return new JsonResponse(['data' => ['pending' => false]], Response::HTTP_NOT_FOUND);
        }

        return new JsonResponse([
            'data' => [
                'pending' => true,
                'confirmation_token' => $details['token_value'],
            ],
        ]);
    }

    /**
     * Determines if the data provided from the session is valid or not. This
     * will return false if the data is invalid, or if more time has passed than
     * was configured when the session was written.
     */
    protected function hasValidSessionData(?array $data): bool
    {
        $validator = $this->validation->make($data ?? [], [
            'user_id' => 'required|integer|min:1',
            'token_value' => 'required|string',
            'expires_at' => 'required',
        ]);

        if ($validator->fails()) {
            return false;
        }

        if (!$data['expires_at'] instanceof CarbonInterface) {
            return false;
        }

        if ($data['expires_at']->isBefore(CarbonImmutable::now())) {
            return false;
        }

        return true;
    }
}
