<?php

namespace Everest\Http\Controllers\Auth;

use Everest\Models\User;
use Illuminate\Support\Str;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;
use Everest\Http\Controllers\Controller;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Support\Facades\Password;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Contracts\Events\Dispatcher;
use Everest\Services\Auth\UserSessionService;
use Illuminate\Auth\Passwords\PasswordBroker;
use Illuminate\Foundation\Auth\ResetsPasswords;
use Everest\Http\Requests\Auth\ResetPasswordRequest;
use Everest\Contracts\Repository\UserRepositoryInterface;

class ResetPasswordController extends Controller
{
    use ResetsPasswords;

    /**
     * The URL to redirect users to after password reset.
     */
    public string $redirectTo = '/';

    protected bool $hasTwoFactor = false;
    private ?ResetPasswordRequest $resetRequest = null;
    private ?string $deviceId = null;
    private bool $shouldSetDeviceCookie = false;

    /**
     * ResetPasswordController constructor.
     */
    public function __construct(
        private Dispatcher $dispatcher,
        private Hasher $hasher,
        private UserRepositoryInterface $userRepository,
        private UserSessionService $sessionService,
    ) {
    }

    /**
     * Reset the given user's password.
     *
     * @throws DisplayException
     */
    public function __invoke(ResetPasswordRequest $request): JsonResponse
    {
        $this->resetRequest = $request;

        // Here we will attempt to reset the user's password. If it is successful we
        // will update the password on an actual user model and persist it to the
        // database. Otherwise, we will parse the error and return the response.
        $response = $this->broker()->reset(
            $this->credentials($request),
            function ($user, $password) {
                $this->resetPassword($user, $password);
            }
        );

        // If the password was successfully reset, we will redirect the user back to
        // the application's home authenticated view. If there is an error we can
        // redirect them back to where they came from with their error message.
        if ($response === Password::PASSWORD_RESET) {
            return $this->sendResetResponse();
        }

        throw new DisplayException(trans($response));
    }

    /**
     * Reset the given user's password. If the user has two-factor authentication enabled on their
     * account do not automatically log them in. In those cases, send the user back to the login
     * form with a note telling them their password was changed and to log back in.
     *
     * @param string $password
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     * @throws \Everest\Exceptions\Repository\RecordNotFoundException
     */
    protected function resetPassword(User $user, $password)
    {
        if ($this->resetRequest === null) {
            throw new \LogicException('The reset request is unavailable.');
        }

        $broker = $this->broker();
        if (!$broker instanceof PasswordBroker) {
            throw new \LogicException('The configured password broker does not support atomic token revocation.');
        }

        $token = (string) $this->resetRequest->input('token');
        $user = DB::transaction(function () use ($user, $password, $broker, $token): User {
            $lockedUser = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            // PasswordBroker validates before invoking this callback. Recheck
            // after taking the user lock so concurrent reset requests cannot
            // both consume the same token.
            if (!$broker->tokenExists($lockedUser, $token)) {
                throw new DisplayException(trans(Password::INVALID_TOKEN));
            }

            $updatedUser = $this->userRepository->update($lockedUser->id, [
                'password' => $this->hasher->make($password),
                $lockedUser->getRememberTokenName() => Str::random(60),
            ]);

            // The synchronous listener revokes sessions and every API key.
            // Keeping it inside this transaction means a database revocation
            // failure also rolls back the password and remember-token change.
            $this->dispatcher->dispatch(new PasswordReset($updatedUser));
            $broker->getRepository()->delete($updatedUser);

            return $updatedUser;
        });

        // If the user is not using 2FA log them in, otherwise skip this step and force a
        // fresh login where they'll be prompted to enter a token.
        if (!$user->use_totp) {
            // The PasswordReset listener has synchronously destroyed every
            // previously tracked session. Establish the replacement login
            // first because SessionGuard::login() migrates the session ID; the
            // durable session record must point at that final ID.
            $this->resetRequest->session()->regenerate();
            $this->guard()->login($user);

            $deviceId = $this->resetRequest->cookie(UserSessionService::DEVICE_COOKIE);
            $this->shouldSetDeviceCookie = $deviceId === null;
            try {
                $this->sessionService->recordLogin(
                    $user,
                    $this->resetRequest->session()->getId(),
                    $deviceId,
                );
                $this->deviceId = $deviceId;
            } catch (\Throwable $exception) {
                // A concurrent suspension/pending transition must not leave an
                // authenticated but untracked recovery session behind.
                $this->guard()->logout();
                $this->resetRequest->session()->invalidate();
                $this->resetRequest->session()->regenerateToken();

                throw $exception;
            }
        }

        $this->hasTwoFactor = $user->use_totp;
    }

    /**
     * Send a successful password reset response back to the callee.
     */
    protected function sendResetResponse(): JsonResponse
    {
        $response = response()->json([
            'success' => true,
            'redirect_to' => $this->redirectTo,
            'send_to_login' => $this->hasTwoFactor,
        ]);

        if ($this->shouldSetDeviceCookie && $this->deviceId) {
            $response->cookie(cookie(
                UserSessionService::DEVICE_COOKIE,
                $this->deviceId,
                60 * 24 * 180,
                config('session.path', '/'),
                config('session.domain'),
                config('session.secure'),
                true,
                false,
                config('session.same_site')
            ));
        }

        return $response;
    }
}
