<?php

namespace Everest\Tests\Integration\Api\Client\Server\Startup;

use Everest\Models\User;
use Illuminate\Http\Response;
use Everest\Models\Permission;
use Illuminate\Support\Facades\Http;
use Everest\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

class GetStartupVariableVersionsTest extends ClientApiIntegrationTestCase
{
    public function testStartupVariableVersionOptionsAreReturnedForSupportedVariable(): void
    {
        [$user, $server] = $this->generateTestAccount([Permission::ACTION_STARTUP_READ]);

        Http::fake([
            'https://ci.md-5.net/*' => Http::response([
                'builds' => [
                    ['number' => 2010],
                    ['number' => 2009],
                    ['number' => 2008],
                ],
            ], 200),
        ]);

        $response = $this->actingAs($user)->getJson(
            $this->link($server) . '/startup/versions?key=BUNGEE_VERSION'
        );

        $response->assertOk();
        $response->assertJsonPath('object', 'startup_variable_versions');
        $response->assertJsonPath('attributes.key', 'BUNGEE_VERSION');
        $response->assertJsonPath('attributes.supported', true);
        $response->assertJsonPath('attributes.provider', 'bungeecord_builds');
        $response->assertJsonPath('attributes.options.0.value', 'latest');
        $response->assertJsonPath('attributes.options.1.value', '2010');
    }

    public function testStartupVariableVersionOptionsEndpointRequiresPermission(): void
    {
        [$user, $server] = $this->generateTestAccount([Permission::ACTION_WEBSOCKET_CONNECT]);

        $this->actingAs($user)
            ->getJson($this->link($server) . '/startup/versions?key=BUNGEE_VERSION')
            ->assertForbidden();

        $randomUser = User::factory()->create();
        $this->actingAs($randomUser)
            ->getJson($this->link($server) . '/startup/versions?key=BUNGEE_VERSION')
            ->assertNotFound();
    }

    public function testStartupVariableVersionOptionsEndpointRejectsMissingVariable(): void
    {
        [$user, $server] = $this->generateTestAccount([Permission::ACTION_STARTUP_READ]);

        $response = $this->actingAs($user)
            ->getJson($this->link($server) . '/startup/versions?key=DOES_NOT_EXIST');

        $response->assertStatus(Response::HTTP_BAD_REQUEST);
        $response->assertJsonPath('errors.0.code', 'BadRequestHttpException');
    }
}
