<?php

namespace Everest\Http\Controllers\Auth\Modules;

use Carbon\Carbon;
use Everest\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\JGuardEntry;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Http\RedirectResponse;
use Everest\Exceptions\DisplayException;
use Everest\Services\Users\UserCreationService;
use Everest\Services\Webhooks\WebhookEventService;
use Everest\Http\Controllers\Auth\AbstractLoginController;
use Everest\Contracts\Repository\SettingsRepositoryInterface;
use Everest\Http\Requests\Auth\CompleteDiscordRegistrationRequest;

class DiscordLoginController extends AbstractLoginController
{
    /**
     * DiscordLoginController constructor.
     */
    public function __construct(
        private UserCreationService $creationService,
        private SettingsRepositoryInterface $settings,
        private WebhookEventService $webhookEventService,
    ) {
        parent::__construct();
    }

    private function getClientId(): ?string
    {
        return $this->settings->get('settings::modules:auth:discord:client_id', config('modules.auth.discord.client_id'));
    }

    private function getClientSecret(): ?string
    {
        return $this->settings->get('settings::modules:auth:discord:client_secret', config('modules.auth.discord.client_secret'));
    }

    /**
     * Get the user's Discord token in order to access the account.
     *
     * @throws DisplayException
     * @throws \Illuminate\Validation\ValidationException
     */
    public function requestToken(Request $request): string
    {
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            $this->sendLockoutResponse($request);
        }

        $state = Str::random(40);
        $request->session()->put('discord_oauth_state', $state);

        return 'https://discord.com/api/oauth2/authorize?'
            . 'client_id=' . $this->getClientId()
            . '&redirect_uri=' . route('auth.modules.discord.authenticate')
            . '&response_type=code&scope=identify%20email'
            . '&state=' . $state;
    }

    /**
     * Show the Discord registration form with pre-filled data from session.
     */
    public function showRegistrationForm(Request $request)
    {
        $discordData = $request->session()->get('discord_registration_data');

        if (!$discordData) {
            return redirect()->route('auth.login')->with('error', 'Discord registration data not found. Please try again.');
        }

        // Return to the React frontend which will handle the form
        return redirect('/auth/discord/register');
    }

    /**
     * Complete the Discord registration with user-provided details.
     */
    public function completeRegistration(CompleteDiscordRegistrationRequest $request): JsonResponse
    {
        $discordData = $request->session()->get('discord_registration_data');

        if (!$discordData) {
            throw new DisplayException('Discord registration data not found. Please try again.');
        }

        // Check if Discord SSO is enabled
        if (!config('modules.auth.discord.enabled', false)) {
            throw new DisplayException('Discord authentication is currently disabled.');
        }

        // Create the user with Discord data (bypassing regular registration check)
        $userData = [
            'username' => $request->input('username'),
            'email' => $discordData['discord_email'],
            'external_id' => $discordData['discord_id'],
            'password' => $request->input('password'),
        ];

        // Create user directly via UserCreationService, bypassing registration.enabled check
        $jguardEnabled = config('modules.auth.jguard.enabled') ?? false;
        $approvalMode = config('modules.auth.jguard.approval_mode', JGuardEntry::MODE_MANUAL);
        $delay = (int) (config('modules.auth.jguard.delay') ?? 60);
        $isPending = $jguardEnabled && $approvalMode !== JGuardEntry::MODE_IMMEDIATE;

        $user = $this->creationService->handle(array_merge($userData, [
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

            $this->webhookEventService->notifyJGuardRegistered($user, $approvalMode, $expiresAt);
        }

        // Clear the session data
        $request->session()->forget('discord_registration_data');

        // Log the user in (new registrations won't have 2FA enabled)
        return $this->sendLoginResponse($user, $request);
    }

    /**
     * Get Discord registration data from session.
     */
    public function getRegistrationData(Request $request): JsonResponse
    {
        $discordData = $request->session()->get('discord_registration_data');

        if (!$discordData) {
            return response()->json(['error' => 'No Discord registration data found'], 404);
        }

        return response()->json([
            'discord_username' => $discordData['discord_username'],
            'discord_email' => $discordData['discord_email'],
            'discord_id' => $discordData['discord_id'],
        ]);
    }

    /**
     * Check if a username is available.
     */
    public function checkUsername(Request $request): JsonResponse
    {
        $username = $request->input('username');

        if (!$username) {
            return response()->json(['available' => false, 'message' => 'Username is required'], 400);
        }

        $exists = User::where('username', $username)->exists();

        return response()->json([
            'available' => !$exists,
            'message' => $exists ? 'This username is already taken' : 'Username is available',
        ]);
    }

    /**
     * Initiate a Discord OAuth flow for linking to an existing authenticated account.
     */
    public function requestLinkToken(Request $request): JsonResponse
    {
        $state = Str::random(40);
        $request->session()->put('discord_oauth_state', $state);
        $request->session()->put('discord_link_user_id', $request->user()->id);

        $url = 'https://discord.com/api/oauth2/authorize?'
            . 'client_id=' . $this->getClientId()
            . '&redirect_uri=' . route('auth.modules.discord.authenticate')
            . '&response_type=code&scope=identify%20email'
            . '&state=' . $state;

        return response()->json(['url' => $url]);
    }

    /**
     * Unlink Discord SSO from the authenticated user's account.
     */
    public function unlinkDiscord(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user->external_id) {
            throw new DisplayException('No Discord account is linked to your account.');
        }

        $user->update(['external_id' => null]);

        return response()->json(['success' => true]);
    }

    /**
     * Authenticate with the Discord OAuth2 service.
     */
    public function authenticate(Request $request): RedirectResponse
    {
        // Validate OAuth state parameter to prevent CSRF attacks
        $sessionState = $request->session()->pull('discord_oauth_state');
        $returnedState = $request->input('state');

        if (!$sessionState || !$returnedState || !hash_equals($sessionState, $returnedState)) {
            return redirect()->route('auth.login')->with('error', 'Invalid OAuth state. Please try again.');
        }

        $response = Http::asForm()->post('https://discord.com/api/oauth2/token', [
            'client_id' => $this->getClientId(),
            'client_secret' => $this->getClientSecret(),
            'grant_type' => 'authorization_code',
            'code' => $request->input('code'),
            'redirect_uri' => route('auth.modules.discord.authenticate'),
        ])->body();

        $response = json_decode($response);

        if (!isset($response->access_token)) {
            return redirect()->route('auth.login')->with('error', 'Failed to authenticate with Discord.');
        }

        $account = Http::withHeaders([
            'Authorization' => 'Bearer ' . $response->access_token,
        ])->asForm()->get('https://discord.com/api/users/@me')->body();

        $account = json_decode($account);

        if (!isset($account->id)) {
            return redirect()->route('auth.login')->with('error', 'Failed to retrieve Discord account information.');
        }

        // Handle account-linking mode for authenticated users
        $linkUserId = $request->session()->pull('discord_link_user_id');
        if ($linkUserId) {
            return $this->handleAccountLinking($request, $account, (int) $linkUserId);
        }

        // Check if user exists with this Discord ID (external_id)
        $user = User::where('external_id', $account->id)->first();

        if ($user) {
            // If user has 2FA enabled, redirect to login for TOTP verification
            if ($user->use_totp) {
                return $this->redirectToTwoFactorChallenge($request, $user);
            }

            // User exists with this Discord ID, log them in
            $loginResponse = $this->sendLoginResponse($user, $request);
            $redirect = redirect('/');

            foreach ($loginResponse->headers->getCookies() as $cookie) {
                $redirect->headers->setCookie($cookie);
            }

            return $redirect;
        }

        // No user found by Discord ID — store Discord data and show choice page
        $request->session()->put('discord_registration_data', [
            'discord_id' => $account->id,
            'discord_username' => $account->username,
            'discord_email' => $account->email,
            'discord_avatar' => $account->avatar ?? null,
        ]);

        return redirect('/auth/discord/link-choice');
    }

    /**
     * Handle linking a Discord account to an existing authenticated user.
     */
    protected function handleAccountLinking(Request $request, object $account, int $userId): RedirectResponse
    {
        $user = User::find($userId);

        if (!$user) {
            return redirect('/account')->with('error', 'Your session expired. Please try linking again.');
        }

        // Ensure this Discord account is not already linked to a different user
        $existingLinked = User::where('external_id', $account->id)
            ->where('id', '!=', $userId)
            ->first();

        if ($existingLinked) {
            return redirect('/account')->with('error', 'This Discord account is already linked to a different user.');
        }

        $user->update(['external_id' => $account->id]);

        return redirect('/account')->with('success', 'Your Discord account has been linked successfully.');
    }

    /**
     * Redirect a user with 2FA enabled to the TOTP verification challenge.
     * Stores the pending authentication in session for the checkpoint flow.
     */
    protected function redirectToTwoFactorChallenge(Request $request, User $user): RedirectResponse
    {
        $token = Str::random(64);

        $request->session()->put('auth_confirmation_token', [
            'user_id' => $user->id,
            'token_value' => $token,
            'expires_at' => CarbonImmutable::now()->addMinutes(5),
        ]);

        return redirect('/auth/login?checkpoint=' . $token);
    }

    /**
     * Create a random string we can use for a temporary username.
     */
    public function randStr(int $length = 10): string
    {
        return substr(str_shuffle(str_repeat($x = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', ceil($length / strlen($x)))), 1, $length);
    }
}
