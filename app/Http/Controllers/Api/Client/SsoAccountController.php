<?php

namespace Everest\Http\Controllers\Api\Client;

use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Models\UserOAuthAccount;
use Everest\Exceptions\DisplayException;
use Everest\Http\Controllers\Auth\Modules\GoogleLoginController;
use Everest\Http\Controllers\Auth\Modules\DiscordLoginController;
use Illuminate\Contracts\Validation\Factory as ValidationFactory;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Everest\Http\Controllers\Auth\Modules\AbstractSocialLoginController;

/**
 * Manage the SSO identities linked to the authenticated account.
 *
 * The outbound leg reuses the provider controllers so the authorize URL, state
 * handling and credential checks stay in one place; the callback recognises a
 * link flow from the session key those controllers set.
 */
class SsoAccountController extends ClientApiController
{
    public function __construct(private ValidationFactory $validation)
    {
        parent::__construct();
    }

    /**
     * Providers linked to this account, plus which ones are available to link.
     */
    public function index(Request $request): JsonResponse
    {
        $linked = $request->user()->oauthAccounts()->get()->keyBy('provider');

        $providers = [];
        foreach (UserOAuthAccount::PROVIDERS as $provider) {
            /** @var UserOAuthAccount|null $account */
            $account = $linked->get($provider);

            $providers[] = [
                'provider' => $provider,
                'label' => UserOAuthAccount::label($provider),
                'enabled' => (bool) config('modules.auth.' . $provider . '.enabled', false),
                'linked' => $account !== null,
                'username' => $account?->provider_username,
                'email' => $account?->provider_email,
                'linked_at' => $account?->created_at?->toIso8601String(),
            ];
        }

        return new JsonResponse(['data' => $providers]);
    }

    /**
     * Begin linking a provider to the authenticated account.
     *
     * @throws DisplayException
     */
    public function link(Request $request, string $provider): JsonResponse
    {
        $controller = $this->controllerFor($provider);

        return $controller->requestLinkToken($request);
    }

    /**
     * Detach a provider from the authenticated account.
     *
     * Gated on the account password. Unlinking removes a way of signing in, and
     * the session asking for it may itself have been opened *through* that
     * provider, so a live session is not on its own evidence that the account
     * owner is the one asking.
     *
     * @throws DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    public function unlink(Request $request, string $provider): Response
    {
        if (!in_array($provider, UserOAuthAccount::PROVIDERS, true)) {
            throw new DisplayException('Unknown authentication provider.');
        }

        $data = $this->validation->make($request->all(), [
            'password' => ['required', 'string'],
        ])->validate();

        /** @var \Everest\Models\User $user */
        $user = $request->user();

        if (!password_verify($data['password'], $user->password)) {
            throw new BadRequestHttpException('The password provided was not valid.');
        }

        $account = $user->oauthAccounts()->where('provider', $provider)->first();
        if (!$account) {
            throw new DisplayException('No ' . UserOAuthAccount::label($provider) . ' account is linked to your account.');
        }

        $account->delete();

        // users.external_id mirrors the Discord link for older code paths.
        if ($provider === UserOAuthAccount::PROVIDER_DISCORD && $user->external_id) {
            $user->update(['external_id' => null]);
        }

        Activity::event('user:sso.unlink')
            ->property('provider', $provider)
            ->log();

        return new Response('', Response::HTTP_NO_CONTENT);
    }

    /**
     * @throws DisplayException
     */
    private function controllerFor(string $provider): AbstractSocialLoginController
    {
        return match ($provider) {
            UserOAuthAccount::PROVIDER_DISCORD => app(DiscordLoginController::class),
            UserOAuthAccount::PROVIDER_GOOGLE => app(GoogleLoginController::class),
            default => throw new DisplayException('Unknown authentication provider.'),
        };
    }
}
