<?php

namespace Everest\Http\Controllers\Auth;

use Everest\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Exceptions\DisplayException;
use Everest\Http\Requests\Auth\RegisterRequest;
use Illuminate\Database\Eloquent\ModelNotFoundException;

class LoginController extends AbstractLoginController
{
    /**
     * Handle a login request to the application.
     *
     * @throws DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    public function login(Request $request): JsonResponse
    {
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            $this->sendLockoutResponse($request);
        }

        try {
            $username = $request->input('user');

            /** @var User $user */
            $user = User::query()->where($this->getField($username), $username)->firstOrFail();
        } catch (ModelNotFoundException) {
            $this->sendFailedLoginResponse($request);
        }

        // Ensure that the account is using a valid username and password before trying to
        // continue. Previously this was handled in the 2FA checkpoint, however that has
        // a flaw in which you can discover if an account exists simply by seeing if you
        // can proceed to the next step in the login process.
        if (!password_verify($request->input('password'), $user->password)) {
            $this->sendFailedLoginResponse($request, $user);
        }

        if (!$user->use_totp) {
            return $this->sendLoginResponse($user, $request);
        }

        Activity::event('auth:checkpoint')->withRequestMetadata()->subject($user)->log();

        $request->session()->put('auth_confirmation_token', [
            'user_id' => $user->id,
            'token_value' => $token = Str::random(64),
            'expires_at' => CarbonImmutable::now()->addMinutes(5),
        ]);

        return new JsonResponse([
            'data' => [
                'complete' => false,
                'confirmation_token' => $token,
            ],
        ]);
    }

    /**
     * Handle a user registration request.
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            $this->sendLockoutResponse($request);
        }

        $user = $this->createAccount($request->validated());

        // Automatically log in the user after successful registration
        return $this->sendLoginResponse($user, $request);
    }

    /**
     * Check if a username is available.
     *
     * SECURITY: This endpoint can be used for account enumeration.
     * Consider rate limiting or removing it if not essential.
     */
    public function checkUsername(Request $request): JsonResponse
    {
        $username = $request->input('username');

        if (!$username) {
            return response()->json(['available' => false, 'message' => 'Username is required'], 400);
        }

        // Add small delay to prevent timing attacks
        usleep(random_int(50000, 150000)); // 50-150ms random delay

        $exists = User::where('username', $username)->exists();

        return response()->json([
            'available' => !$exists,
            'message' => $exists ? 'This username is already taken' : 'Username is available',
        ]);
    }

    /**
     * Log the user out of the application.
     */
    public function logout(Request $request): JsonResponse
    {
        if ($request->user()) {
            app(\Everest\Services\Auth\UserSessionService::class)
                ->revokeBySessionId($request->user(), $request->session()->getId(), false);
        }

        $this->guard()->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}
