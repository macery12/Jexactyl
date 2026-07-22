<?php

namespace Everest\Http\Controllers\Api\Client;

use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Contracts\Validation\Factory as ValidationFactory;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;

class RecoveryCodeController extends ClientApiController
{
    public function __construct(private ValidationFactory $validation)
    {
        parent::__construct();
    }

    /**
     * Returns whether the user has generated and acknowledged a recovery code.
     * The code itself is stored hashed and can never be read back, so this only
     * reports state — it is used to nudge users who have not saved a code.
     */
    public function index(Request $request): JsonResponse
    {
        /** @var \Everest\Models\User $user */
        $user = $request->user();

        return new JsonResponse([
            'object' => 'recovery_code_status',
            'attributes' => [
                'has_code' => !empty($user->recovery_code),
                'seen' => (bool) $user->recovery_code_seen,
            ],
        ]);
    }

    /**
     * Generates a fresh offline recovery code after re-authenticating the user
     * with their password. Any previous code is invalidated. The plaintext is
     * returned exactly once here and never stored in reversible form.
     *
     * @throws \Throwable
     * @throws \Illuminate\Validation\ValidationException
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validation->make($request->all(), [
            'password' => ['required', 'string'],
        ])->validate();

        /** @var \Everest\Models\User $user */
        $user = $request->user();

        if (!password_verify($data['password'], $user->password)) {
            throw new BadRequestHttpException('The password provided was not valid.');
        }

        $plain = Str::random(32);

        $user->forceFill([
            'recovery_code' => Hash::make($plain),
            'recovery_code_seen' => true,
        ])->saveOrFail();

        Activity::event('user:recovery-code.regenerate')->log();

        return new JsonResponse([
            'object' => 'recovery_code',
            'attributes' => [
                'code' => $plain,
            ],
        ]);
    }

    /**
     * Marks the recovery code as seen/acknowledged. Called after the code has been
     * presented to the user (e.g. the one-time reveal on the registration screen)
     * so we stop nudging them to save it. Does not touch the code itself.
     */
    public function acknowledge(Request $request): JsonResponse
    {
        /** @var \Everest\Models\User $user */
        $user = $request->user();

        $user->forceFill(['recovery_code_seen' => true])->saveOrFail();

        return new JsonResponse([], 204);
    }
}
