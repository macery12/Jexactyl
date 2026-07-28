<?php

namespace Everest\Http\Controllers\Auth;

use Everest\Models\User;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Http\RedirectResponse;
use Everest\Exceptions\DisplayException;
use Everest\Services\Email\EmailManager;
use Illuminate\Validation\Rules\Password;
use Everest\Models\EmailNotificationSetting;
use Everest\Services\Users\UserUpdateService;
use Everest\Services\Auth\PasswordResetService;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Everest\Services\Users\UserCredentialRevocationService;

class ForgotPasswordController extends AbstractLoginController
{
    /**
     * ForgotPasswordController constructor.
     */
    public function __construct(
        private UserUpdateService $updateService,
        private PasswordResetService $passwordResetService,
        private UserCredentialRevocationService $credentials,
    ) {
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

        $user = DB::transaction(function () use ($user, $request): ?User {
            $lockedUser = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            // Recheck only after taking the row lock so one recovery code cannot
            // win two concurrent password resets.
            if (
                empty($lockedUser->recovery_code)
                || !Hash::check((string) $request->input('code'), $lockedUser->recovery_code)
            ) {
                return null;
            }

            // Revoke before establishing the replacement login. These database
            // mutations share this transaction with the password and recovery
            // code rotation, so a failure cannot leave the new password paired
            // with old sessions or API keys.
            $this->credentials->revokeAll($lockedUser);

            return $this->updateService->handle($lockedUser, [
                'password' => $request->input('password'),
                'recovery_code' => Hash::make(Str::random(32)),
                'recovery_code_seen' => false,
            ]);
        });

        if (!$user) {
            throw new DisplayException('The information provided was incorrect.');
        }

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
