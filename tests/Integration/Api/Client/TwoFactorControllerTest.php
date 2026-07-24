<?php

namespace Everest\Tests\Integration\Api\Client;

use Carbon\Carbon;
use Everest\Models\User;
use Illuminate\Http\Response;
use Everest\Models\RecoveryToken;
use PragmaRX\Google2FA\Google2FA;
use PHPUnit\Framework\ExpectationFailedException;

class TwoFactorControllerTest extends ClientApiIntegrationTestCase
{
    private const TOTP_SECRET = 'AAAAAAAAAAAAAAAA';

    /**
     * Test that image data for enabling 2FA is returned by the endpoint and that the user
     * record in the database is updated as expected.
     */
    public function testTwoFactorImageDataIsReturned()
    {
        /** @var User $user */
        $user = User::factory()->create(['use_totp' => false]);

        $this->assertFalse($user->use_totp);
        $this->assertEmpty($user->totp_secret);
        $this->assertEmpty($user->totp_authenticated_at);

        $response = $this->actingAs($user)->getJson('/api/client/account/two-factor');

        $response->assertOk();
        $response->assertJsonStructure(['data' => ['image_url_data']]);

        $user = $user->refresh();

        $this->assertFalse($user->use_totp);
        $this->assertNotEmpty($user->totp_secret);
        $this->assertEmpty($user->totp_authenticated_at);
    }

    /**
     * Test that an error is returned if the user's account already has 2FA enabled on it.
     */
    public function testErrorIsReturnedWhenTwoFactorIsAlreadyEnabled()
    {
        /** @var User $user */
        $user = User::factory()->create(['use_totp' => true]);

        $response = $this->actingAs($user)->getJson('/api/client/account/two-factor');

        $response->assertStatus(Response::HTTP_BAD_REQUEST);
        $response->assertJsonPath('errors.0.code', 'BadRequestHttpException');
        $response->assertJsonPath('errors.0.detail', 'Two-factor authentication is already enabled on this account.');
    }

    /**
     * Test that a validation error is thrown if invalid data is passed to the 2FA endpoint.
     */
    public function testValidationErrorIsReturnedIfInvalidDataIsPassedToEnabled2FA()
    {
        /** @var User $user */
        $user = User::factory()->create(['use_totp' => false]);

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor', ['code' => ''])
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.meta.rule', 'required')
            ->assertJsonPath('errors.0.meta.source_field', 'code')
            ->assertJsonPath('errors.1.meta.rule', 'required')
            ->assertJsonPath('errors.1.meta.source_field', 'password');
    }

    /**
     * Tests that 2FA can be enabled on an account for the user.
     */
    public function testTwoFactorCanBeEnabledOnAccount()
    {
        /** @var User $user */
        $user = User::factory()->create(['use_totp' => false]);

        // Make the initial call to get the account setup for 2FA.
        $this->actingAs($user)->getJson('/api/client/account/two-factor')->assertOk();

        $user = $user->refresh();
        $this->assertNotNull($user->totp_secret);

        /** @var Google2FA $service */
        $service = $this->app->make(Google2FA::class);

        $secret = decrypt($user->totp_secret);
        $token = $service->getCurrentOtp($secret);

        $response = $this->actingAs($user)->postJson('/api/client/account/two-factor', [
            'code' => $token,
            'password' => 'password',
        ]);

        $response->assertOk();
        $response->assertJsonPath('object', 'recovery_tokens');

        $user = $user->refresh();
        $this->assertTrue($user->use_totp);

        $tokens = RecoveryToken::query()->where('user_id', $user->id)->get();
        $this->assertCount(10, $tokens);
        $this->assertStringStartsWith('$2y$10$', $tokens[0]->token);
        // Ensure the recovery tokens that were created include a "created_at" timestamp
        // value on them.
        //
        // @see https://github.com/pterodactyl/panel/issues/3163
        $this->assertNotNull($tokens[0]->created_at->toIso8601String());

        $tokens = $tokens->pluck('token')->toArray();

        foreach ($response->json('attributes.tokens') as $raw) {
            foreach ($tokens as $hashed) {
                if (password_verify($raw, $hashed)) {
                    continue 2;
                }
            }

            throw new ExpectationFailedException(sprintf('Failed asserting that token [%s] exists as a hashed value in recovery_tokens table.', $raw));
        }
    }

    /**
     * Creates an account with two-factor genuinely enabled — a real encrypted
     * secret, not just the `use_totp` flag — so a code can be verified against it.
     */
    private function userWithTwoFactor(): User
    {
        return User::factory()->create([
            'use_totp' => true,
            'totp_secret' => encrypt(self::TOTP_SECRET),
        ]);
    }

    private function currentCode(): string
    {
        return $this->app->make(Google2FA::class)->getCurrentOtp(self::TOTP_SECRET);
    }

    /**
     * Test that two-factor authentication can be disabled on an account when both
     * the password and a current authentication code are provided.
     */
    public function testTwoFactorCanBeDisabledOnAccount()
    {
        Carbon::setTestNow(Carbon::now());

        $user = $this->userWithTwoFactor();

        $response = $this->actingAs($user)->postJson('/api/client/account/two-factor/disable', [
            'password' => 'invalid',
            'code' => $this->currentCode(),
        ]);

        $response->assertStatus(Response::HTTP_BAD_REQUEST);
        $response->assertJsonPath('errors.0.code', 'BadRequestHttpException');
        $response->assertJsonPath('errors.0.detail', 'The password provided was not valid.');

        $response = $this->actingAs($user)->postJson('/api/client/account/two-factor/disable', [
            'password' => 'password',
            'code' => $this->currentCode(),
        ]);

        $response->assertStatus(Response::HTTP_NO_CONTENT);

        $user = $user->refresh();
        $this->assertFalse($user->use_totp);
        $this->assertNotNull($user->totp_authenticated_at);
        $this->assertTrue(Carbon::now()->equalTo($user->totp_authenticated_at));
    }

    /**
     * The password alone must not switch two-factor off — that is exactly the move
     * an attacker holding a stolen password or a hijacked session would make.
     */
    public function testDisablingTwoFactorRequiresTheSecondFactor()
    {
        $user = $this->userWithTwoFactor();

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor/disable', ['password' => 'password'])
            ->assertStatus(Response::HTTP_BAD_REQUEST)
            ->assertJsonPath(
                'errors.0.detail',
                'A two-factor code or recovery token is required to disable two-factor authentication.'
            );

        $this->assertTrue($user->refresh()->use_totp);
    }

    /**
     * Test that an incorrect authentication code is refused.
     */
    public function testDisablingTwoFactorRejectsAnInvalidCode()
    {
        $user = $this->userWithTwoFactor();

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor/disable', [
                'password' => 'password',
                'code' => '000000',
            ])
            ->assertStatus(Response::HTTP_BAD_REQUEST)
            ->assertJsonPath('errors.0.detail', 'The two-factor code provided is not valid.');

        $this->assertTrue($user->refresh()->use_totp);
    }

    /**
     * A recovery token works in place of a code, and is consumed on use.
     */
    public function testDisablingTwoFactorAcceptsARecoveryToken()
    {
        $user = $this->userWithTwoFactor();

        // The real service bulk-inserts these, so the model has no fillable list.
        RecoveryToken::query()->forceCreate([
            'user_id' => $user->id,
            'token' => password_hash('recovery-1', PASSWORD_DEFAULT),
        ]);

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor/disable', [
                'password' => 'password',
                'recovery_token' => 'recovery-1',
            ])
            ->assertStatus(Response::HTTP_NO_CONTENT);

        $this->assertFalse($user->refresh()->use_totp);
        $this->assertSame(0, RecoveryToken::query()->where('user_id', $user->id)->count());
    }

    /**
     * Test that an unrecognised recovery token is refused.
     */
    public function testDisablingTwoFactorRejectsAnInvalidRecoveryToken()
    {
        $user = $this->userWithTwoFactor();

        // The real service bulk-inserts these, so the model has no fillable list.
        RecoveryToken::query()->forceCreate([
            'user_id' => $user->id,
            'token' => password_hash('recovery-1', PASSWORD_DEFAULT),
        ]);

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor/disable', [
                'password' => 'password',
                'recovery_token' => 'not-the-token',
            ])
            ->assertStatus(Response::HTTP_BAD_REQUEST)
            ->assertJsonPath('errors.0.detail', 'The recovery token provided is not valid.');

        $this->assertTrue($user->refresh()->use_totp);
        $this->assertSame(1, RecoveryToken::query()->where('user_id', $user->id)->count());
    }

    /**
     * Test that no error is returned when trying to disabled two factor on an account where it
     * was not enabled in the first place.
     */
    public function testNoErrorIsReturnedIfTwoFactorIsNotEnabled()
    {
        Carbon::setTestNow(Carbon::now());

        /** @var User $user */
        $user = User::factory()->create(['use_totp' => false]);

        $response = $this->actingAs($user)->postJson('/api/client/account/two-factor/disable', [
            'password' => 'password',
        ]);

        $response->assertStatus(Response::HTTP_NO_CONTENT);
    }

    /**
     * Test that a valid account password is required when enabling two-factor.
     */
    public function testEnablingTwoFactorRequiresValidPassword()
    {
        $user = User::factory()->create(['use_totp' => false]);

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor', [
                'code' => '123456',
                'password' => 'foo',
            ])
            ->assertStatus(Response::HTTP_BAD_REQUEST)
            ->assertJsonPath('errors.0.detail', 'The password provided was not valid.');

        $this->assertFalse($user->refresh()->use_totp);
    }

    /**
     * Test that a valid account password is required when disabling two-factor.
     */
    public function testDisablingTwoFactorRequiresValidPassword()
    {
        $user = $this->userWithTwoFactor();

        $this->actingAs($user)
            ->postJson('/api/client/account/two-factor/disable', [
                'password' => 'foo',
                'code' => $this->currentCode(),
            ])
            ->assertStatus(Response::HTTP_BAD_REQUEST)
            ->assertJsonPath('errors.0.detail', 'The password provided was not valid.');

        $this->assertTrue($user->refresh()->use_totp);
    }
}
