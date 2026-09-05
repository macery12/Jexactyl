<?php

namespace Everest\Tests\Integration\Http\Controllers\Auth;

use Everest\Models\User;
use Everest\Models\JGuardEntry;
use PragmaRX\Google2FA\Google2FA;
use Everest\Events\Auth\DirectLogin;
use Everest\Models\UserOAuthAccount;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Session;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Http\Controllers\Auth\Modules\AbstractSocialLoginController as Sso;

/**
 * Covers both provider callbacks plus the shared signup/link endpoints.
 */
class SsoLoginTest extends IntegrationTestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Event::fake([DirectLogin::class]);

        config()->set('modules.auth.discord.enabled', true);
        config()->set('modules.auth.discord.client_id', 'client-id');
        config()->set('modules.auth.discord.client_secret', 'client-secret');
        config()->set('modules.auth.google.enabled', true);
        config()->set('modules.auth.google.client_id', 'google-client-id');
        config()->set('modules.auth.google.client_secret', 'google-client-secret');
    }

    /**
     * Stub Discord's token + identity endpoints.
     */
    private function fakeDiscord(string $id, string $email, string $username = 'ssouser'): void
    {
        Http::fake([
            'discord.com/api/oauth2/token' => Http::response(['access_token' => 'token']),
            'discord.com/api/users/@me' => Http::response([
                'id' => $id,
                'username' => $username,
                'email' => $email,
                'avatar' => null,
            ]),
        ]);
    }

    private function hitCallback(string $state = 'state-value'): \Illuminate\Testing\TestResponse
    {
        Session::put(Sso::STATE_SESSION_KEY, $state);

        return $this->get(route('auth.modules.discord.authenticate', ['code' => 'auth-code', 'state' => $state]));
    }

    private function fakeGoogle(
        string $id,
        string $email,
        string $name = 'Google User',
        ?string $picture = null,
    ): void {
        Http::fake([
            'oauth2.googleapis.com/token' => Http::response(['access_token' => 'google-token']),
            'openidconnect.googleapis.com/v1/userinfo' => Http::response([
                'sub' => $id,
                'email' => $email,
                'name' => $name,
                'picture' => $picture,
            ]),
        ]);
    }

    private function hitGoogleCallback(string $state = 'google-state'): \Illuminate\Testing\TestResponse
    {
        Session::put(Sso::STATE_SESSION_KEY, $state);

        return $this->get(route('auth.modules.google.authenticate', ['code' => 'auth-code', 'state' => $state]));
    }

    public function testGoogleAuthorizeUrlContainsAnIssuedState(): void
    {
        $url = $this->post('/auth/modules/google')->assertOk()->getContent();
        $parts = parse_url($url);
        parse_str($parts['query'] ?? '', $query);

        $this->assertSame('accounts.google.com', $parts['host'] ?? null);
        $this->assertSame('/o/oauth2/v2/auth', $parts['path'] ?? null);
        $this->assertSame('google-client-id', $query['client_id'] ?? null);
        $this->assertSame('code', $query['response_type'] ?? null);
        $this->assertSame('openid profile email', $query['scope'] ?? null);
        $this->assertSame(Session::get(Sso::STATE_SESSION_KEY), $query['state'] ?? null);
    }

    public function testGoogleCallbackLogsInALinkedIdentity(): void
    {
        $user = User::factory()->create();
        UserOAuthAccount::create([
            'user_id' => $user->id,
            'provider' => UserOAuthAccount::PROVIDER_GOOGLE,
            'provider_user_id' => 'google-9988',
        ]);
        $this->fakeGoogle('google-9988', $user->email);

        $this->hitGoogleCallback()->assertRedirect('/');

        $this->assertAuthenticatedAs($user);
    }

    public function testGoogleCallbackNormalizesANewIdentity(): void
    {
        $this->fakeGoogle(
            'google-1122',
            'google-user@m12labs.test-suite.net',
            'New Google User',
            'https://images.example/avatar.png',
        );

        $this->hitGoogleCallback()->assertRedirect('/auth/sso/link-choice');

        $this->assertSame([
            'provider' => UserOAuthAccount::PROVIDER_GOOGLE,
            'id' => 'google-1122',
            'email' => 'google-user@m12labs.test-suite.net',
            'username' => 'New Google User',
            'avatar' => 'https://images.example/avatar.png',
        ], Session::get(Sso::REGISTRATION_SESSION_KEY));
    }

    public function testGoogleCallbackRejectsMismatchedAndReplayedState(): void
    {
        Http::fake();
        Session::put(Sso::STATE_SESSION_KEY, 'expected-google-state');

        $callback = route('auth.modules.google.authenticate', ['code' => 'auth-code']);
        $this->get($callback . '&state=forged')
            ->assertRedirect('/auth/login?sso_error=invalid_state');
        $this->get($callback . '&state=expected-google-state')
            ->assertRedirect('/auth/login?sso_error=invalid_state');

        Http::assertNothingSent();
    }

    public function testGoogleCallbackRequiresAnAuthorizationCode(): void
    {
        Session::put(Sso::STATE_SESSION_KEY, 'google-state');

        $this->get(route('auth.modules.google.authenticate', ['state' => 'google-state']))
            ->assertRedirect('/auth/login?sso_error=missing_code');
    }

    public function testGoogleProviderFailureRedirectsInsteadOfThrowing(): void
    {
        Http::fake([
            'oauth2.googleapis.com/token' => Http::response(['error' => 'invalid_grant'], 400),
        ]);

        $this->hitGoogleCallback()->assertRedirect('/auth/login?sso_error=provider_error');
    }

    public function testCallbackLogsInAUserWithALinkedIdentity(): void
    {
        $user = User::factory()->create();
        UserOAuthAccount::create([
            'user_id' => $user->id,
            'provider' => UserOAuthAccount::PROVIDER_DISCORD,
            'provider_user_id' => '99887766',
        ]);

        $this->fakeDiscord('99887766', $user->email);

        $this->hitCallback()->assertRedirect('/');
        $this->assertAuthenticatedAs($user);
    }

    /**
     * Regression: an SSO user with 2FA used to be redirected to
     * `/auth/login?checkpoint=<token>`, a query string the SPA never read, so the
     * login silently dead-ended. It must land on the checkpoint route instead,
     * with the token held in the session rather than the URL.
     */
    public function testCallbackSendsTwoFactorUsersToTheCheckpoint(): void
    {
        $user = User::factory()->create([
            'use_totp' => true,
            'totp_secret' => encrypt(str_repeat('a', 16)),
        ]);
        UserOAuthAccount::create([
            'user_id' => $user->id,
            'provider' => UserOAuthAccount::PROVIDER_DISCORD,
            'provider_user_id' => '55443322',
        ]);

        $this->fakeDiscord('55443322', $user->email);

        $this->hitCallback()->assertRedirect('/auth/login/checkpoint');
        $this->assertGuest();

        // The token is readable only by this session, and never appeared in a URL.
        $response = $this->getJson(route('auth.login-checkpoint.pending'))->assertOk();
        $token = $response->json('data.confirmation_token');
        $this->assertNotEmpty($token);

        $totp = $this->app->make(Google2FA::class)->getCurrentOtp(str_repeat('a', 16));

        $this->postJson(route('auth.login-checkpoint'), [
            'confirmation_token' => $token,
            'authentication_code' => $totp,
        ])->assertOk()->assertJsonPath('data.complete', true);

        $this->assertAuthenticatedAs($user);
    }

    public function testPendingCheckpointEndpointIsEmptyWithoutALogin(): void
    {
        $this->getJson(route('auth.login-checkpoint.pending'))
            ->assertNotFound()
            ->assertJsonPath('data.pending', false);
    }

    public function testUnknownIdentityGoesToTheLinkChoicePage(): void
    {
        $this->fakeDiscord('11223344', 'newcomer@m12labs.test-suite.net');

        $this->hitCallback()->assertRedirect('/auth/sso/link-choice');
        $this->assertGuest();

        $this->getJson(route('auth.sso.registration-data'))
            ->assertOk()
            ->assertJsonPath('provider', 'discord')
            ->assertJsonPath('email', 'newcomer@m12labs.test-suite.net')
            ->assertJsonPath('email_taken', false);
    }

    /**
     * An address that already belongs to an account is reported as taken so the
     * link-choice page leads with linking instead of offering a duplicate signup.
     */
    public function testExistingEmailIsReportedAsTaken(): void
    {
        $existing = User::factory()->create();
        $this->fakeDiscord('44556677', $existing->email);

        $this->hitCallback()->assertRedirect('/auth/sso/link-choice');

        $this->getJson(route('auth.sso.registration-data'))
            ->assertOk()
            ->assertJsonPath('email_taken', true);

        // And signup for that address is refused outright.
        $this->postJson(route('auth.sso.complete'), [
            'username' => 'duplicate',
            'password' => 'Sup3rSecret!Passw0rd',
            'confirm_password' => 'Sup3rSecret!Passw0rd',
        ])->assertStatus(400);
    }

    public function testMismatchedStateIsRejected(): void
    {
        $this->fakeDiscord('77889900', 'attacker@m12labs.test-suite.net');

        Session::put(Sso::STATE_SESSION_KEY, 'the-real-state');

        $this->get(route('auth.modules.discord.authenticate', ['code' => 'auth-code', 'state' => 'forged']))
            ->assertRedirect('/auth/login?sso_error=invalid_state');
    }

    public function testCancelledConsentReportsCleanly(): void
    {
        $this->get(route('auth.modules.discord.authenticate', ['error' => 'access_denied']))
            ->assertRedirect('/auth/login?sso_error=cancelled');
    }

    public function testDisabledModuleRefusesTheCallback(): void
    {
        config()->set('modules.auth.discord.enabled', false);

        $this->get(route('auth.modules.discord.authenticate', ['code' => 'x', 'state' => 'y']))
            ->assertRedirect('/auth/login?sso_error=module_disabled');
    }

    /**
     * A provider failure (revoked code, network error) must surface on the login
     * page rather than escaping as an unhandled 500.
     */
    public function testProviderFailureRedirectsInsteadOfThrowing(): void
    {
        Http::fake([
            'discord.com/api/oauth2/token' => Http::response(['error' => 'invalid_grant'], 400),
        ]);

        $this->hitCallback()->assertRedirect('/auth/login?sso_error=provider_error');
    }

    public function testCompletingSignupCreatesAndLinksTheAccount(): void
    {
        $this->fakeDiscord('12312312', 'brand-new@m12labs.test-suite.net', 'brandnew');
        $this->hitCallback();

        $this->postJson(route('auth.sso.complete'), [
            'username' => 'brandnew',
            'password' => 'Sup3rSecret!Passw0rd',
            'confirm_password' => 'Sup3rSecret!Passw0rd',
        ])->assertOk()->assertJsonPath('data.complete', true);

        $user = User::where('username', 'brandnew')->firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertSame('brand-new@m12labs.test-suite.net', $user->email);

        // Linked in the new table, and external_id kept in step for Discord.
        $this->assertTrue($user->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
        $this->assertSame('12312312', $user->refresh()->external_id);
    }

    /**
     * SSO signup is subject to jGuard exactly like email signup: the account is
     * created and held, and no session is issued.
     */
    public function testSsoSignupRespectsJGuard(): void
    {
        config()->set('modules.auth.jguard.enabled', true);
        config()->set('modules.auth.jguard.approval_mode', JGuardEntry::MODE_MANUAL);

        $this->fakeDiscord('45645645', 'held@m12labs.test-suite.net', 'helduser');
        $this->hitCallback();

        $this->postJson(route('auth.sso.complete'), [
            'username' => 'helduser',
            'password' => 'Sup3rSecret!Passw0rd',
            'confirm_password' => 'Sup3rSecret!Passw0rd',
        ])
            ->assertOk()
            ->assertJsonPath('data.complete', false)
            ->assertJsonPath('data.user_state', 'pending');

        $this->assertGuest();

        $user = User::where('username', 'helduser')->firstOrFail();
        $this->assertSame('pending', $user->state);
        $this->assertTrue(JGuardEntry::where('user_id', $user->id)->exists());
    }

    /**
     * A held account cannot then sign in through the provider either.
     */
    public function testCallbackRefusesAPendingAccount(): void
    {
        $user = User::factory()->create(['state' => 'pending']);
        JGuardEntry::create([
            'user_id' => $user->id,
            'status' => JGuardEntry::STATUS_PENDING,
            'approval_mode' => JGuardEntry::MODE_MANUAL,
            'expires_at' => null,
        ]);
        UserOAuthAccount::create([
            'user_id' => $user->id,
            'provider' => UserOAuthAccount::PROVIDER_DISCORD,
            'provider_user_id' => '31313131',
        ]);

        $this->fakeDiscord('31313131', $user->email);

        $response = $this->hitCallback();
        $this->assertStringContainsString('sso_error=account_unavailable', $response->headers->get('Location'));
        $this->assertGuest();
    }

    /**
     * "Sign in to link" only attaches the identity once the password check
     * actually passes — a matching email address alone must never be enough.
     */
    public function testLinkAfterLoginAttachesTheIdentity(): void
    {
        $user = User::factory()->create([
            'password' => password_hash('Password123!', PASSWORD_DEFAULT),
        ]);

        $this->fakeDiscord('98765432', $user->email, 'linkme');
        $this->hitCallback();

        $this->postJson(route('auth.sso.link-intent'))->assertOk();

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])->assertOk();

        $this->assertAuthenticatedAs($user);
        $this->assertTrue($user->refresh()->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
    }

    public function testLinkIsNotAppliedWithoutTheExplicitIntent(): void
    {
        $user = User::factory()->create([
            'password' => password_hash('Password123!', PASSWORD_DEFAULT),
        ]);

        // Identity present in the session, but the user never chose to link it.
        $this->fakeDiscord('19191919', $user->email);
        $this->hitCallback();

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])->assertOk();

        $this->assertFalse($user->refresh()->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
    }

    /**
     * One provider identity cannot be attached to two panel accounts.
     */
    public function testIdentityClaimedByAnotherAccountIsNotStolen(): void
    {
        $owner = User::factory()->create();
        UserOAuthAccount::create([
            'user_id' => $owner->id,
            'provider' => UserOAuthAccount::PROVIDER_DISCORD,
            'provider_user_id' => '50505050',
        ]);

        $other = User::factory()->create([
            'password' => password_hash('Password123!', PASSWORD_DEFAULT),
        ]);

        $this->fakeDiscord('50505050', $other->email);
        // Force the "unknown identity" branch by clearing the resolved link only
        // in the session payload the link flow reads.
        Session::put(Sso::REGISTRATION_SESSION_KEY, [
            'provider' => 'discord',
            'id' => '50505050',
            'email' => $other->email,
            'username' => 'claimed',
            'avatar' => null,
        ]);
        Session::put(Sso::LINK_AFTER_LOGIN_SESSION_KEY, true);

        $this->postJson('/auth/login', [
            'user' => $other->username,
            'password' => 'Password123!',
        ])->assertOk();

        $this->assertFalse($other->refresh()->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
        $this->assertSame($owner->id, UserOAuthAccount::where('provider_user_id', '50505050')->first()->user_id);
    }
}
