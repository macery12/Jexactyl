<?php

namespace Everest\Http\Controllers\Auth;

use Carbon\Carbon;
use Everest\Models\User;
use Illuminate\Http\Request;
use Everest\Models\JGuardEntry;
use Illuminate\Auth\AuthManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Auth\Events\Failed;
use Illuminate\Container\Container;
use Illuminate\Support\Facades\Log;
use Everest\Events\Auth\DirectLogin;
use Illuminate\Support\Facades\Event;
use Everest\Exceptions\DisplayException;
use Everest\Http\Controllers\Controller;
use Everest\Services\Auth\UserSessionService;
use Illuminate\Contracts\Auth\Authenticatable;
use Everest\Services\Users\UserCreationService;
use Everest\Services\Webhooks\WebhookEventService;
use Illuminate\Foundation\Auth\AuthenticatesUsers;

abstract class AbstractLoginController extends Controller
{
    use AuthenticatesUsers;

    protected AuthManager $auth;
    protected UserSessionService $sessionService;

    /**
     * Lockout time for failed login requests.
     */
    protected int $lockoutTime;

    /**
     * After how many attempts should logins be throttled and locked.
     */
    protected int $maxLoginAttempts;

    /**
     * Where to redirect users after login / registration.
     */
    protected string $redirectTo = '/';

    /**
     * LoginController constructor.
     */
    public function __construct()
    {
        $this->lockoutTime = config('auth.lockout.time');
        $this->maxLoginAttempts = (int) config('modules.auth.security.attempts');
        $this->auth = Container::getInstance()->make(AuthManager::class);
        $this->creation = Container::getInstance()->make(UserCreationService::class);
        $this->sessionService = Container::getInstance()->make(UserSessionService::class);
    }

    /**
     * Get the failed login response instance.
     *
     * SECURITY: Uses a generic error message to prevent account enumeration.
     * The same message is returned whether the username or password is incorrect.
     *
     * @return never
     *
     * @throws DisplayException
     */
    protected function sendFailedLoginResponse(Request $request, ?Authenticatable $user = null, ?string $message = null)
    {
        $this->incrementLoginAttempts($request);

        // Fire failed login event if user was found
        if ($user) {
            $this->fireFailedLoginEvent($user, [
                $this->getField($request->input('user')) => $request->input('user'),
            ]);
        }

        if ($request->route()->named('auth.login-checkpoint')) {
            throw new DisplayException($message ?? trans('auth.two_factor.checkpoint_failed'));
        }

        // Generic error message - don't reveal if user exists or password is wrong
        throw new DisplayException(trans('auth.failed'));
    }

    /**
     * Send the response after the user was authenticated.
     */
    protected function sendLoginResponse(User $user, Request $request): JsonResponse
    {
        $request->session()->remove('auth_confirmation_token');
        $request->session()->regenerate();

        $this->clearLoginAttempts($request);

        $this->auth->guard()->login($user, true);

        $deviceId = $request->cookie(UserSessionService::DEVICE_COOKIE);
        $shouldSetCookie = $deviceId === null;

        $this->sessionService->recordLogin($user, $request->session()->getId(), $deviceId);
        Log::info('AbstractLoginController: login response generated', [
            'user_id' => $user->id,
            'session_id' => $request->session()->getId(),
            'device_id' => $deviceId,
            'set_cookie' => $shouldSetCookie,
        ]);

        Event::dispatch(new DirectLogin($user, true));

        $responseData = [
            'complete' => true,
            'intended' => $this->redirectPath(),
            'user' => $user->toReactObject(),
        ];

        // Surface the freshly generated offline recovery code exactly once, on the
        // registration login response. It is null on every ordinary login, so this
        // key is only ever present immediately after account creation.
        if (!empty($user->recoveryCodePlain)) {
            $responseData['recovery_code'] = $user->recoveryCodePlain;
        }

        $response = new JsonResponse([
            'data' => $responseData,
        ]);

        if ($shouldSetCookie && $deviceId) {
            $response->cookie(
                cookie(
                    UserSessionService::DEVICE_COOKIE,
                    $deviceId,
                    60 * 24 * 180,
                    config('session.path', '/'),
                    config('session.domain'),
                    config('session.secure'),
                    true,
                    false,
                    config('session.same_site')
                )
            );
        }

        return $response;
    }

    /**
     * Create an account on the Panel if the details do not exist.
     * When jGuard is enabled, the account is created in a pending state
     * until an admin approves it (manual mode) or the delay elapses (delayed mode).
     */
    public function createAccount(array $data): User
    {
        $enabled = config('modules.auth.registration.enabled') ?? false;

        if (!$enabled) {
            throw new DisplayException('User signup is disabled at this time.');
        }

        if (User::where('username', $data['username'])->exists()) {
            throw new DisplayException('This username is already in use by another user.');
        }

        $jguardEnabled = config('modules.auth.jguard.enabled') ?? false;
        $approvalMode = config('modules.auth.jguard.approval_mode', JGuardEntry::MODE_MANUAL);
        $delay = (int) (config('modules.auth.jguard.delay') ?? 60);

        // When jGuard is active and the mode is not immediate, hold the account pending.
        $isPending = $jguardEnabled && $approvalMode !== JGuardEntry::MODE_IMMEDIATE;

        $user = $this->creation->handle(array_merge($data, [
            'state' => $isPending ? 'pending' : null,
        ]));

        if ($isPending) {
            $expiresAt = $approvalMode === JGuardEntry::MODE_DELAYED
                ? Carbon::now()->addMinutes($delay)
                : null;

            JGuardEntry::create([
                'user_id' => $user->id,
                'status' => JGuardEntry::STATUS_PENDING,
                'approval_mode' => $approvalMode,
                'expires_at' => $expiresAt,
            ]);

            Container::getInstance()->make(WebhookEventService::class)
                ->notifyJGuardRegistered($user, $approvalMode, $expiresAt);
        }

        return $user;
    }

    /**
     * Determine if the user is logging in using an email or username.
     */
    protected function getField(?string $input = null): string
    {
        return ($input && str_contains($input, '@')) ? 'email' : 'username';
    }

    /**
     * Fire a failed login event.
     */
    protected function fireFailedLoginEvent(?Authenticatable $user = null, array $credentials = [])
    {
        Event::dispatch(new Failed('auth', $user, $credentials));
    }
}
