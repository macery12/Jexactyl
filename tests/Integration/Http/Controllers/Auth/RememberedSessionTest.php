<?php

namespace Everest\Tests\Integration\Http\Controllers\Auth;

use Everest\Models\User;
use Everest\Models\UserSession;
use Everest\Services\Auth\UserSessionService;
use Everest\Tests\Integration\IntegrationTestCase;

/**
 * Regression cover for the forced-logout bug.
 *
 * A lapsed session plus a valid "remember me" cookie used to sign the user out
 * instead of restoring them: SessionGuard regenerates the session id when the
 * recaller logs someone back in, so the user_sessions row written at login no
 * longer matched and UpdateUserSessionActivity's fail-closed check rejected the
 * request. These tests pin both halves of the fix — the session is restored, and
 * a revoked device still cannot walk back in on its cookie.
 */
class RememberedSessionTest extends IntegrationTestCase
{
    private const DEVICE_ID = 'test-device-id';

    public function setUp(): void
    {
        parent::setUp();

        // The device fingerprint is sha256(deviceCookie|userAgent|ip/24), and the
        // cookie is what keeps it stable across requests — sendLoginResponse sets
        // it for 180 days on the first login. Without it here, recordLogin() and
        // recordRememberedSession() would derive different fingerprints and the
        // tests would exercise the reject path by accident rather than by intent.
        request()->cookies->set(UserSessionService::DEVICE_COOKIE, self::DEVICE_ID);
    }

    public function testRememberedLoginIsRetrackedInsteadOfRejected(): void
    {
        $user = User::factory()->create();
        $service = app(UserSessionService::class);
        $deviceId = self::DEVICE_ID;

        $original = $service->recordLogin($user, 'original-session-id', $deviceId);
        $this->assertNull($original->revoked_at);

        // The id the recaller path would land on.
        $restored = $service->recordRememberedSession($user, 'regenerated-session-id');

        $this->assertNotNull($restored, 'a remembered session must be re-tracked, not rejected');
        $this->assertSame($original->id, $restored->id, 'the existing device row should be reused, not duplicated');
        $this->assertSame('regenerated-session-id', $restored->refresh()->session_id);
        $this->assertSame(1, UserSession::query()->where('user_id', $user->id)->count());
    }

    public function testRevokedDeviceIsStillRefused(): void
    {
        $user = User::factory()->create();
        $service = app(UserSessionService::class);
        $deviceId = self::DEVICE_ID;

        $session = $service->recordLogin($user, 'original-session-id', $deviceId);
        $service->revokeSession($user, $session, false);

        $this->assertNull(
            $service->recordRememberedSession($user, 'regenerated-session-id'),
            'a revoked device must not be able to restore itself from a remember-me cookie',
        );
    }

    public function testRevokingCyclesTheRememberTokenSoRecallerCookiesDie(): void
    {
        $user = User::factory()->create(['remember_token' => 'original-remember-token']);
        $service = app(UserSessionService::class);
        $deviceId = self::DEVICE_ID;

        $session = $service->recordLogin($user, 'original-session-id', $deviceId);
        $service->revokeSession($user, $session, false);

        $this->assertNotSame(
            'original-remember-token',
            $user->refresh()->getRememberToken(),
            'revoking a session must invalidate the per-user remember token',
        );
    }

    public function testRevokeAllCyclesTheRememberToken(): void
    {
        $user = User::factory()->create(['remember_token' => 'original-remember-token']);
        $service = app(UserSessionService::class);
        $deviceId = self::DEVICE_ID;

        $service->recordLogin($user, 'original-session-id', $deviceId);
        $service->revokeAll($user);

        $this->assertNotSame(
            'original-remember-token',
            $user->refresh()->getRememberToken(),
            '"sign out everywhere" must invalidate the per-user remember token',
        );
    }

    public function testSuspendedUserCannotRestoreFromRecaller(): void
    {
        $user = User::factory()->create();
        $service = app(UserSessionService::class);
        $deviceId = self::DEVICE_ID;
        $service->recordLogin($user, 'original-session-id', $deviceId);

        // User::isSuspended() compares the raw string; there is no constant.
        $user->update(['state' => 'suspended']);

        $this->assertNull(
            $service->recordRememberedSession($user->refresh(), 'regenerated-session-id'),
            'a suspended account must not regain a session from a cookie',
        );
    }
}
