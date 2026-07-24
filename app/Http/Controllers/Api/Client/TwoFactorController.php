<?php

namespace Everest\Http\Controllers\Api\Client;

use Carbon\Carbon;
use Everest\Models\User;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Services\Users\TwoFactorSetupService;
use Everest\Services\Users\ToggleTwoFactorService;
use Everest\Services\Users\TwoFactorVerificationService;
use Illuminate\Contracts\Validation\Factory as ValidationFactory;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

class TwoFactorController extends ClientApiController
{
    /**
     * TwoFactorController constructor.
     */
    public function __construct(
        private ToggleTwoFactorService $toggleTwoFactorService,
        private TwoFactorSetupService $setupService,
        private TwoFactorVerificationService $verification,
        private ValidationFactory $validation,
    ) {
        parent::__construct();
    }

    /**
     * Returns two-factor token credentials that allow a user to configure
     * it on their account. If two-factor is already enabled this endpoint
     * will return a 400 error.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     * @throws \Everest\Exceptions\Repository\RecordNotFoundException
     */
    public function index(Request $request): JsonResponse
    {
        if ($request->user()->use_totp) {
            throw new BadRequestHttpException('Two-factor authentication is already enabled on this account.');
        }

        return new JsonResponse([
            'data' => $this->setupService->handle($request->user()),
        ]);
    }

    /**
     * Updates a user's account to have two-factor enabled.
     *
     * @throws \Throwable
     * @throws \Illuminate\Validation\ValidationException
     */
    public function store(Request $request): JsonResponse
    {
        $validator = $this->validation->make($request->all(), [
            'code' => ['required', 'string', 'size:6'],
            'password' => ['required', 'string'],
        ]);

        $data = $validator->validate();
        if (!password_verify($data['password'], $request->user()->password)) {
            throw new BadRequestHttpException('The password provided was not valid.');
        }

        $tokens = $this->toggleTwoFactorService->handle($request->user(), $data['code'], true);

        Activity::event('user:two-factor.create')->log();

        return new JsonResponse([
            'object' => 'recovery_tokens',
            'attributes' => [
                'tokens' => $tokens,
            ],
        ]);
    }

    /**
     * Disables two-factor authentication on an account.
     *
     * Requires the account password *and* the second factor itself — either a
     * current TOTP code or one of the recovery tokens. Turning 2FA off is the
     * single change that undoes every other protection on the account, so a
     * stolen password or a hijacked session must not be enough on its own.
     *
     * @throws \Throwable
     * @throws \Illuminate\Validation\ValidationException
     */
    public function delete(Request $request): JsonResponse
    {
        $data = $this->validation->make($request->all(), [
            'password' => ['required', 'string'],
            'code' => ['nullable', 'string'],
            'recovery_token' => ['nullable', 'string'],
        ])->validate();

        /** @var User $user */
        $user = $request->user();

        if (!password_verify($data['password'], $user->password)) {
            throw new BadRequestHttpException('The password provided was not valid.');
        }

        // An account without 2FA enabled has no second factor to present, and
        // this endpoint stays a no-op for it.
        if ($user->use_totp) {
            $this->assertSecondFactor($user, $data['code'] ?? null, $data['recovery_token'] ?? null);
        }

        $user->update([
            'totp_authenticated_at' => Carbon::now(),
            'use_totp' => false,
        ]);

        Activity::event('user:two-factor.delete')->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Requires exactly one of a TOTP code or a recovery token, and that it checks out.
     *
     * A recovery token wins when both are sent, matching the login checkpoint,
     * so a half-filled form can never quietly verify against the other field.
     *
     * @throws \PragmaRX\Google2FA\Exceptions\IncompatibleWithGoogleAuthenticatorException
     * @throws \PragmaRX\Google2FA\Exceptions\InvalidCharactersException
     * @throws \PragmaRX\Google2FA\Exceptions\SecretKeyTooShortException
     */
    private function assertSecondFactor(User $user, ?string $code, ?string $recoveryToken): void
    {
        if (!empty($recoveryToken)) {
            if (!$this->verification->consumeRecoveryToken($user, $recoveryToken)) {
                throw new BadRequestHttpException('The recovery token provided is not valid.');
            }

            return;
        }

        if (empty($code)) {
            throw new BadRequestHttpException('A two-factor code or recovery token is required to disable two-factor authentication.');
        }

        if (!$this->verification->isValidTotp($user, $code)) {
            throw new BadRequestHttpException('The two-factor code provided is not valid.');
        }
    }
}
