<?php

namespace Everest\Http\Controllers\Auth;

use Everest\Models\User;
use Everest\Models\EmailNotificationSetting;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Everest\Exceptions\DisplayException;
use Everest\Services\Users\UserUpdateService;
use Everest\Services\Auth\PasswordResetService;
use Everest\Services\Email\EmailManager;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

class ForgotPasswordController extends AbstractLoginController
{
    /**
     * ForgotPasswordController constructor.
     */
    public function __construct(
        private UserUpdateService $updateService,
        private PasswordResetService $passwordResetService
    )
    {
        parent::__construct();
    }

    /**
     * Validate the information provided for resetting a password.
     */
    public function verify(Request $request): JsonResponse|RedirectResponse
    {
        $request->validate([
            'email' => 'required|email',
            'code' => 'required|string',
            'password' => [
                'required',
                'string',
                'confirmed',
                Password::min(8)
                    ->mixedCase()
                    ->numbers()
                    ->symbols()
                    ->uncompromised(),
            ],
        ]);

        try {
            $user = User::where('email', $request->input('email'))->firstOrFail();
        } catch (ModelNotFoundException $ex) {
            throw new DisplayException('The information provided was incorrect.');
        }

        // The recovery code is stored hashed (irreversible). Hash::check performs a
        // constant-time comparison. An empty/legacy stored value fails closed.
        if (empty($user->recovery_code) || !Hash::check((string) $request->input('code'), $user->recovery_code)) {
            throw new DisplayException('The information provided was incorrect.');
        }

        // Rotate the recovery code immediately so it cannot be replayed. It is stored
        // hashed; the fresh plaintext is intentionally discarded here — the user must
        // regenerate from account settings to obtain a new one.
        $user = $this->updateService->handle($user, [
            'password' => $request->input('password'),
            'recovery_code' => Hash::make(Str::random(32)),
            'recovery_code_seen' => false,
        ]);

        if (!$user->use_totp) {
            return $this->sendLoginResponse($user, $request);
        }

        return response()->json(['redirect_to' => route('auth.login')]);
    }

    public function method(): JsonResponse
    {
        return response()->json([
            'method' => $this->isEmailResetEnabled() ? 'email' : 'recovery_code',
        ]);
    }

    public function requestEmailReset(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        if ($this->isEmailResetEnabled()) {
            $this->passwordResetService->sendResetLink($request->string('email')->toString());
        }

        return response()->json([
            'message' => 'If account exists, reset email sent',
        ]);
    }

    public function resetWithToken(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
            'token' => 'required|string',
            'password' => [
                'required',
                'string',
                'confirmed',
                Password::min(8)
                    ->mixedCase()
                    ->numbers()
                    ->symbols()
                    ->uncompromised(),
            ],
        ]);

        $success = $this->passwordResetService->resetPassword(
            $request->string('email')->toString(),
            $request->string('token')->toString(),
            $request->string('password')->toString()
        );

        if (!$success) {
            throw new DisplayException('The password reset token is invalid or has expired.');
        }

        return response()->json(['success' => true]);
    }

    private function isEmailResetEnabled(): bool
    {
        if (!EmailNotificationSetting::isEnabled('auth.password_reset')) {
            return false;
        }

        return EmailManager::isDeliveryEnabled();
    }
}
