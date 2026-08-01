<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Client\Servers\Files;

use Mockery as m;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Illuminate\Routing\Route;
use Everest\Models\Permission;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Http\Requests\Api\Client\Servers\Files\PullFileRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\UploadFileRequest;
use Everest\Http\Requests\Api\Client\Servers\Mods\DownloadModRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\DecompressFilesRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileContentRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class OverwriteCapableFileRequestTest extends TestCase
{
    #[DataProvider('requestProvider')]
    public function testCreateWithoutUpdateCannotReachOverwriteCapableDaemonOperation(string $requestClass): void
    {
        $request = new $requestClass();
        $server = new Server();
        $route = m::mock(Route::class);
        $route->expects('parameter')->with('server')->andReturn($server);

        $user = m::mock(User::class);
        $user->expects('can')->with(Permission::ACTION_FILE_CREATE, $server)->andReturnTrue();
        $user->expects('can')->with(Permission::ACTION_FILE_UPDATE, $server)->andReturnFalse();

        $request->setRouteResolver(fn () => $route);
        $request->setUserResolver(fn () => $user);

        $this->assertFalse($request->authorize());
    }

    #[DataProvider('requestProvider')]
    public function testCreateAndUpdateAuthorizeOverwriteCapableDaemonOperation(string $requestClass): void
    {
        $request = new $requestClass();
        $server = new Server();
        $route = m::mock(Route::class);
        $route->expects('parameter')->with('server')->andReturn($server);

        $user = m::mock(User::class);
        $user->expects('can')->with(Permission::ACTION_FILE_CREATE, $server)->andReturnTrue();
        $user->expects('can')->with(Permission::ACTION_FILE_UPDATE, $server)->andReturnTrue();

        $request->setRouteResolver(fn () => $route);
        $request->setUserResolver(fn () => $user);

        $this->assertTrue($request->authorize());
    }

    public static function requestProvider(): array
    {
        return [
            'raw write' => [WriteFileContentRequest::class],
            'write with diff' => [WriteFileWithDiffRequest::class],
            'direct upload' => [UploadFileRequest::class],
            'remote pull' => [PullFileRequest::class],
            'archive extraction' => [DecompressFilesRequest::class],
            'marketplace download' => [DownloadModRequest::class],
        ];
    }
}
