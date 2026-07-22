<?php

namespace Everest\Http\Controllers\Api\Client;

use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Auth\AuthManager;
use Illuminate\Http\JsonResponse;
use Everest\Services\Auth\UserSessionService;
use Everest\Services\Users\UserUpdateService;
use Everest\Transformers\Api\Client\AccountTransformer;
use Everest\Http\Requests\Api\Client\Account\SetupUserRequest;
use Everest\Http\Requests\Api\Client\Account\UpdateEmailRequest;
use Everest\Http\Requests\Api\Client\Account\UpdateLanguageRequest;
use Everest\Http\Requests\Api\Client\Account\UpdatePasswordRequest;

class AccountController extends ClientApiController
{
    /**
     * AccountController constructor.
     */
    public function __construct(
        private AuthManager $manager,
        private UserUpdateService $updateService,
        private UserSessionService $sessions,
    ) {
        parent::__construct();
    }

    public function index(Request $request): array
    {
        return $this->fractal->item($request->user())
            ->transformWith(AccountTransformer::class)
            ->toArray();
    }

    /**
     * Update the authenticated user's email address.
     */
    public function updateEmail(UpdateEmailRequest $request): JsonResponse
    {
        $original = $request->user()->email;
        $this->updateService->handle($request->user(), $request->validated());

        if ($original !== $request->input('email')) {
            Activity::event('user:account.email-changed')
                ->property(['old' => $original, 'new' => $request->input('email')])
                ->log();
        }

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Update the authenticated user's password. All existing sessions will be logged
     * out immediately.
     *
     * @throws \Throwable
     */
    public function updatePassword(UpdatePasswordRequest $request): JsonResponse
    {
        $user = $this->updateService->handle($request->user(), $request->validated());

        $guard = $this->manager->guard();
        // If you do not update the user in the session you'll end up working with a
        // cached copy of the user that does not include the updated password. Do this
        // to correctly store the new user details in the guard and allow the logout
        // other devices functionality to work.
        $guard->setUser($user);

        // This method doesn't exist in the stateless Sanctum world.
        if (method_exists($guard, 'logoutOtherDevices')) {
            $guard->logoutOtherDevices($request->input('password'));
        }

        // logoutOtherDevices() only rehashes the remember-me password hash; without
        // Laravel's AuthenticateSession middleware -- which this panel registers on the
        // /admin prefix only -- it never terminates a live session. The docblock above
        // and the "Other devices have been signed out" message in the UI both promise
        // that it does, so revoke through the panel's own session store, which does.
        $this->sessions->revokeAll($user, $request->hasSession() ? $request->session()->getId() : null);

        Activity::event('user:account.password-changed')->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Update the authenticated user's preferred panel language. A null value
     * clears the preference so the account follows the panel-wide default.
     */
    public function updateLanguage(UpdateLanguageRequest $request): JsonResponse
    {
        $user = $request->user();
        $original = $user->language;

        $user->forceFill(['language' => $request->input('language')])->saveOrFail();

        if ($original !== $user->language) {
            Activity::event('user:account.language-changed')
                ->property(['old' => $original, 'new' => $user->language])
                ->log();
        }

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Set up an account when registered with OAuth2.
     */
    public function setup(SetupUserRequest $request): JsonResponse
    {
        $user = $this->updateService->handle($request->user(), $request->validated());

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}
