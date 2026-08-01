<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Client\Servers\Mods;

use Mockery as m;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Illuminate\Routing\Route;
use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\Servers\Mods\InstallModpackRequest;

class InstallModpackRequestTest extends TestCase
{
    public function testExtractionRequiresCreateAndUpdate(): void
    {
        $request = $this->request(['wipe_server' => false], [
            Permission::ACTION_FILE_CREATE => true,
            Permission::ACTION_FILE_UPDATE => false,
        ]);

        $this->assertFalse($request->authorize());
    }

    public function testNonWipingExtractionAllowsCreateAndUpdate(): void
    {
        $request = $this->request(['wipe_server' => false], [
            Permission::ACTION_FILE_CREATE => true,
            Permission::ACTION_FILE_UPDATE => true,
        ]);

        $this->assertTrue($request->authorize());
    }

    public function testWipingExtractionAlsoRequiresDelete(): void
    {
        $request = $this->request(['wipe_server' => true], [
            Permission::ACTION_FILE_CREATE => true,
            Permission::ACTION_FILE_UPDATE => true,
            Permission::ACTION_FILE_DELETE => false,
        ]);

        $this->assertFalse($request->authorize());
    }

    /**
     * @param array<string, bool> $permissions
     */
    private function request(array $input, array $permissions): InstallModpackRequest
    {
        $request = new InstallModpackRequest();
        $request->replace($input);
        $server = new Server();
        $route = m::mock(Route::class);
        $route->allows('parameter')->with('server')->andReturn($server);

        $user = m::mock(User::class);
        foreach ($permissions as $permission => $allowed) {
            $user->allows('can')->with($permission, $server)->andReturn($allowed);
        }

        $request->setRouteResolver(fn () => $route);
        $request->setUserResolver(fn () => $user);

        return $request;
    }
}
