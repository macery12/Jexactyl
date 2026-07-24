<?php

namespace Everest\Tests\Integration\Http\Controllers\Auth;

use Everest\Models\User;
use Everest\Models\JGuardEntry;
use Everest\Events\Auth\DirectLogin;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Session;
use Everest\Tests\Integration\IntegrationTestCase;

/**
 * jGuard and suspension are enforced at login, not only by middleware on the
 * client API. Before this, a held or suspended account could authenticate, hold
 * a real session, and reach everything outside /api/client.
 */
class AccountStateGateTest extends IntegrationTestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Event::fake([DirectLogin::class]);
    }

    private function pendingUser(string $mode = JGuardEntry::MODE_MANUAL, ?\DateTimeInterface $expiresAt = null): User
    {
        $user = User::factory()->create([
            'state' => 'pending',
            'password' => password_hash('Password123!', PASSWORD_DEFAULT),
        ]);

        JGuardEntry::create([
            'user_id' => $user->id,
            'status' => JGuardEntry::STATUS_PENDING,
            'approval_mode' => $mode,
            'expires_at' => $expiresAt,
        ]);

        return $user;
    }

    public function testPendingAccountCannotLogIn(): void
    {
        $user = $this->pendingUser();

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'AccountPendingApprovalException');

        $this->assertGuest();
    }

    public function testPendingMessageIsConfigurable(): void
    {
        config()->set('modules.auth.jguard.pending_message', 'Hang tight, staff are reviewing this.');

        $user = $this->pendingUser();

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])
            ->assertForbidden()
            ->assertJsonPath('errors.0.detail', 'Hang tight, staff are reviewing this.');
    }

    /**
     * 'delayed' accounts release themselves once the window passes, so a login
     * landing between scheduler runs is not turned away.
     */
    public function testDelayedAccountIsReleasedOnceExpired(): void
    {
        $user = $this->pendingUser(JGuardEntry::MODE_DELAYED, now()->subMinute());

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])
            ->assertOk()
            ->assertJsonPath('data.complete', true);

        $this->assertNull($user->refresh()->state);
        $this->assertSame(JGuardEntry::STATUS_APPROVED, JGuardEntry::where('user_id', $user->id)->first()->status);
    }

    public function testDelayedAccountIsStillHeldBeforeExpiry(): void
    {
        $user = $this->pendingUser(JGuardEntry::MODE_DELAYED, now()->addHour());

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])->assertForbidden();

        $this->assertGuest();
    }

    /**
     * A 'pending' state with no matching entry is stale bookkeeping (jGuard
     * switched off, entry pruned) and must not lock the account out forever.
     */
    public function testStalePendingStateIsCleared(): void
    {
        $user = User::factory()->create([
            'state' => 'pending',
            'password' => password_hash('Password123!', PASSWORD_DEFAULT),
        ]);

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])->assertOk();

        $this->assertNull($user->refresh()->state);
    }

    public function testSuspendedAccountCannotLogIn(): void
    {
        $user = User::factory()->create([
            'state' => 'suspended',
            'password' => password_hash('Password123!', PASSWORD_DEFAULT),
        ]);

        $this->postJson('/auth/login', [
            'user' => $user->username,
            'password' => 'Password123!',
        ])
            ->assertForbidden()
            ->assertJsonPath('errors.0.code', 'AccountSuspendedException');

        $this->assertGuest();
    }

    /**
     * The gate also has to hold on the far side of a 2FA challenge — an account
     * suspended between the password step and the code step must not get in.
     */
    public function testCheckpointRefusesSuspendedAccount(): void
    {
        $user = User::factory()->create([
            'state' => 'suspended',
            'use_totp' => true,
            'totp_secret' => encrypt(str_repeat('a', 16)),
        ]);

        Session::put('auth_confirmation_token', [
            'user_id' => $user->id,
            'token_value' => 'token',
            'expires_at' => now()->addMinutes(5),
        ]);

        $totp = $this->app->make(\PragmaRX\Google2FA\Google2FA::class)->getCurrentOtp(str_repeat('a', 16));

        $this->postJson(route('auth.login-checkpoint'), [
            'confirmation_token' => 'token',
            'authentication_code' => $totp,
        ])->assertForbidden();

        $this->assertGuest();
    }

    /**
     * Registration under jGuard returns the pending shape instead of a session —
     * the response the SPA's "awaiting approval" screen keys off.
     */
    public function testRegistrationUnderJGuardReturnsPendingInsteadOfSession(): void
    {
        config()->set('modules.auth.registration.enabled', true);
        config()->set('modules.auth.jguard.enabled', true);
        config()->set('modules.auth.jguard.approval_mode', JGuardEntry::MODE_MANUAL);

        $this->postJson('/auth/register', [
            'username' => 'pendinguser',
            'email' => 'pending@m12labs.test-suite.net',
            'password' => 'Sup3rSecret!Passw0rd',
            'password_confirmation' => 'Sup3rSecret!Passw0rd',
        ])
            ->assertOk()
            ->assertJsonPath('data.complete', false)
            ->assertJsonPath('data.user_state', 'pending');

        $this->assertGuest();

        $user = User::where('username', 'pendinguser')->first();
        $this->assertNotNull($user);
        $this->assertSame('pending', $user->state);
        $this->assertTrue(JGuardEntry::where('user_id', $user->id)->exists());
    }

    /**
     * 'immediate' mode means jGuard records nothing and the account is live.
     */
    public function testImmediateModeDoesNotHoldRegistrations(): void
    {
        config()->set('modules.auth.registration.enabled', true);
        config()->set('modules.auth.jguard.enabled', true);
        config()->set('modules.auth.jguard.approval_mode', JGuardEntry::MODE_IMMEDIATE);

        $this->postJson('/auth/register', [
            'username' => 'liveuser',
            'email' => 'live@m12labs.test-suite.net',
            'password' => 'Sup3rSecret!Passw0rd',
            'password_confirmation' => 'Sup3rSecret!Passw0rd',
        ])
            ->assertOk()
            ->assertJsonPath('data.complete', true);

        $user = User::where('username', 'liveuser')->first();
        $this->assertNull($user->state);
        $this->assertFalse(JGuardEntry::where('user_id', $user->id)->exists());
    }
}
