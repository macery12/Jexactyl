<?php

namespace Everest\Tests\Integration\Api\Client;

use Everest\Models\User;
use Illuminate\Http\Response;
use Everest\Models\UserOAuthAccount;

class SsoAccountControllerTest extends ClientApiIntegrationTestCase
{
    private function userWithDiscord(): User
    {
        /** @var User $user */
        $user = User::factory()->create(['external_id' => '12345678']);

        UserOAuthAccount::create([
            'user_id' => $user->id,
            'provider' => UserOAuthAccount::PROVIDER_DISCORD,
            'provider_user_id' => '12345678',
        ]);

        return $user;
    }

    /**
     * Unlinking removes a way of signing in, and the session asking may itself
     * have been opened through that provider — so the account password is
     * required, not just a live session.
     */
    public function testUnlinkingRequiresThePassword()
    {
        $user = $this->userWithDiscord();

        $this->actingAs($user)
            ->deleteJson('/api/client/account/sso/discord')
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.meta.rule', 'required')
            ->assertJsonPath('errors.0.meta.source_field', 'password');

        $this->assertTrue($user->refresh()->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
    }

    public function testUnlinkingRejectsAnInvalidPassword()
    {
        $user = $this->userWithDiscord();

        $this->actingAs($user)
            ->deleteJson('/api/client/account/sso/discord', ['password' => 'not-the-password'])
            ->assertStatus(Response::HTTP_BAD_REQUEST)
            ->assertJsonPath('errors.0.detail', 'The password provided was not valid.');

        $this->assertTrue($user->refresh()->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
    }

    public function testUnlinkingSucceedsWithThePassword()
    {
        $user = $this->userWithDiscord();

        $this->actingAs($user)
            ->deleteJson('/api/client/account/sso/discord', ['password' => 'password'])
            ->assertStatus(Response::HTTP_NO_CONTENT);

        $user = $user->refresh();
        $this->assertFalse($user->hasOAuthProvider(UserOAuthAccount::PROVIDER_DISCORD));
        // users.external_id mirrors the Discord link for older code paths.
        $this->assertNull($user->external_id);
    }

    /**
     * `{provider}` is a free-form route segment, so it is validated against the
     * known list rather than reaching the database.
     */
    public function testUnknownProviderIsRefused()
    {
        $user = $this->userWithDiscord();

        $this->actingAs($user)
            ->deleteJson('/api/client/account/sso/telepathy', ['password' => 'password'])
            ->assertStatus(Response::HTTP_BAD_REQUEST);
    }
}
