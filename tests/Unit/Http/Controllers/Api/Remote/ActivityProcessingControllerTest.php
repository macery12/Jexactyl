<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Remote;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Subuser;
use Everest\Tests\TestCase;
use Illuminate\Support\Collection;
use Everest\Http\Controllers\Api\Remote\ActivityProcessingController;

class ActivityProcessingControllerTest extends TestCase
{
    public function testActorResolutionIsLimitedToTheSpecificServerRelationship(): void
    {
        $owner = $this->user('3b770493-911b-461d-a10f-c6ed38e002c5', 10);
        $subuser = $this->user('32e0401d-632c-4487-b34d-f7037e645b5d', 11);
        $foreign = $this->user('e54250b8-cb89-4e29-ac4e-ed574fed7d3d', 12);

        $assignment = new Subuser(['user_id' => $subuser->id]);
        $assignment->setRelation('user', $subuser);

        $server = new Server(['owner_id' => $owner->id]);
        $server->setRelation('user', $owner);
        $server->setRelation('subusers', new Collection([$assignment]));

        $method = new \ReflectionMethod(ActivityProcessingController::class, 'actorForServer');
        $controller = new ActivityProcessingController();

        $this->assertSame($owner, $method->invoke($controller, $server, $owner->uuid));
        $this->assertSame($subuser, $method->invoke($controller, $server, $subuser->uuid));
        $this->assertNull($method->invoke($controller, $server, $foreign->uuid));
        $this->assertNull($method->invoke($controller, $server, null));
    }

    private function user(string $uuid, int $id): User
    {
        $user = new User();
        $user->forceFill(['uuid' => $uuid]);
        $user->id = $id;

        return $user;
    }
}
