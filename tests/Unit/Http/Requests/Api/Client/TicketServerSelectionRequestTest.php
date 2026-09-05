<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Client;

use Everest\Models\User;
use Everest\Models\Egg;
use Everest\Models\Nest;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Validator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Everest\Tests\Traits\Integration\CreatesTestModels;
use Everest\Http\Requests\Api\Client\Tickets\StoreTicketRequest;

class TicketServerSelectionRequestTest extends TestCase
{
    use RefreshDatabase;
    use CreatesTestModels;

    public function testTicketServerMustBelongToTheSubmittingUser(): void
    {
        $user = User::factory()->create();
        $nest = Nest::factory()->create();
        $egg = Egg::factory()->create([
            'nest_id' => $nest->id,
            'author' => 'tickets@example.com',
            'docker_images' => ['example/image:latest'],
            'config_stop' => 'stop',
            'config_startup' => '{}',
            'config_files' => '{}',
        ]);
        $owned = $this->createServerModel([
            'owner_id' => $user->id,
            'nest_id' => $nest->id,
            'egg_id' => $egg->id,
        ]);
        $other = $this->createServerModel([
            'nest_id' => $nest->id,
            'egg_id' => $egg->id,
        ]);

        $request = new StoreTicketRequest();
        $request->setUserResolver(static fn (): User => $user);
        $rules = $request->rules();
        $base = [
            'title' => 'Server will not start',
            'message' => 'The server stops during startup.',
        ];

        $this->assertTrue(Validator::make($base + ['server_id' => null], $rules)->passes());
        $this->assertTrue(Validator::make($base + ['server_id' => $owned->id], $rules)->passes());
        $this->assertFalse(Validator::make($base + ['server_id' => $other->id], $rules)->passes());

        config()->set('modules.tickets.enabled', true);
        config()->set('modules.tickets.max_count', 5);

        $response = $this->actingAs($user)
            ->postJson('/api/client/account/tickets', $base + ['server_id' => $owned->id]);
        $response
            ->assertOk()
            ->assertJsonPath('attributes.server_id', $owned->id)
            ->assertJsonPath('attributes.server.name', $owned->name);

        $this->assertDatabaseHas('tickets', [
            'user_id' => $user->id,
            'server_id' => $owned->id,
            'title' => $base['title'],
        ]);

        $this->actingAs($user)
            ->postJson('/api/client/account/tickets', $base + [
                'title' => 'A different server',
                'server_id' => $other->id,
            ])
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.meta.source_field', 'server_id')
            ->assertJsonPath('errors.0.meta.rule', 'exists');
    }
}
