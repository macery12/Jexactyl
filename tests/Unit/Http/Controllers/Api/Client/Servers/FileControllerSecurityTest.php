<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Client\Servers;

use Mockery as m;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Route;
use Psr\Http\Message\ResponseInterface;
use Everest\Services\Nodes\NodeJWTService;
use Everest\Services\Files\FileDiffService;
use Everest\Services\Activity\ActivityLogService;
use Everest\Repositories\Wings\DaemonFileRepository;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Everest\Http\Controllers\Api\Client\Servers\FileController;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class FileControllerSecurityTest extends TestCase
{
    private const ENDPOINT = '/_tests/client/servers/test-server/files/write-with-diff';

    private User $owner;

    private Server $server;

    public function setUp(): void
    {
        parent::setUp();

        $this->owner = (new User())->forceFill([
            'id' => 1001,
            'uuid' => '00000000-0000-4000-8000-000000001001',
            'root_admin' => false,
        ]);
        $this->server = (new Server())->forceFill([
            'id' => 2001,
            'uuid' => '00000000-0000-4000-8000-000000002001',
            'owner_id' => $this->owner->id,
        ]);
        $this->server->setRelation('subusers', collect());

        Route::bind('server', fn () => $this->server);
        Route::post(
            '/_tests/client/servers/{server}/files/write-with-diff',
            [FileController::class, 'writeWithDiff']
        )->middleware(SubstituteBindings::class);

        $this->mock(NodeJWTService::class);
    }

    public function testValidationFailureCannotReachTheDaemonRepository(): void
    {
        $repository = $this->mock(DaemonFileRepository::class);
        $repository->shouldNotReceive('setServer');
        $repository->shouldNotReceive('putContent');

        $diff = $this->mock(FileDiffService::class);
        $diff->shouldNotReceive('isTextFile');
        $diff->shouldNotReceive('calculateDiff');

        $response = $this->actingAs($this->owner)->postJson(self::ENDPOINT, [
            'file' => '/server.properties',
            'content' => str_repeat("\n", WriteFileWithDiffRequest::MAX_CONTENT_LINES),
            'original_content' => '',
        ]);

        $response->assertStatus(Response::HTTP_UNPROCESSABLE_ENTITY);
    }

    public function testAuthorizationFailureCannotReachValidationWorkOrTheDaemon(): void
    {
        $repository = $this->mock(DaemonFileRepository::class);
        $repository->shouldNotReceive('setServer');
        $repository->shouldNotReceive('putContent');

        $diff = $this->mock(FileDiffService::class);
        $diff->shouldNotReceive('isTextFile');
        $diff->shouldNotReceive('calculateDiff');

        $otherUser = (new User())->forceFill([
            'id' => 1002,
            'uuid' => '00000000-0000-4000-8000-000000001002',
            'root_admin' => false,
        ]);

        $response = $this->actingAs($otherUser)->postJson(self::ENDPOINT, [
            'file' => '/server.properties',
            'content' => 'safe',
            'original_content' => '',
        ]);

        $response->assertForbidden();
    }

    public function testDiffIsCalculatedBeforeAnyDaemonMutation(): void
    {
        $calls = [];
        $diffResult = [
            'additions' => 1,
            'deletions' => 1,
            'hunks' => [],
            'is_new_file' => false,
            'log_truncated' => false,
        ];

        $diff = $this->mock(FileDiffService::class);
        $diff->shouldReceive('isTextFile')
            ->once()
            ->with('/server.properties')
            ->andReturnUsing(function () use (&$calls): bool {
                $calls[] = 'is-text';

                return true;
            });
        $diff->shouldReceive('calculateDiff')
            ->once()
            ->with('before', 'after', '/server.properties')
            ->andReturnUsing(function () use (&$calls, $diffResult): array {
                $calls[] = 'calculate';

                return $diffResult;
            });

        $repository = $this->mock(DaemonFileRepository::class);
        $repository->shouldReceive('setServer')
            ->once()
            ->with(m::on(fn (Server $server) => $server === $this->server))
            ->andReturnUsing(function () use (&$calls, $repository): DaemonFileRepository {
                $calls[] = 'set-server';

                return $repository;
            });
        $repository->shouldReceive('getContent')
            ->once()
            ->with('/server.properties', WriteFileWithDiffRequest::MAX_CONTENT_BYTES)
            ->andReturnUsing(function () use (&$calls): string {
                $calls[] = 'get-content';

                return 'before';
            });
        $repository->shouldReceive('putContent')
            ->once()
            ->with('/server.properties', 'after')
            ->andReturnUsing(function () use (&$calls): ResponseInterface {
                $calls[] = 'put-content';

                return m::mock(ResponseInterface::class);
            });

        $this->fakeActivityLogger();

        $response = $this->actingAs($this->owner)->postJson(self::ENDPOINT, [
            'file' => '/server.properties',
            'content' => 'after',
            'original_content' => 'before',
        ]);

        $response->assertNoContent();
        $this->assertSame(['set-server', 'get-content', 'is-text', 'calculate', 'put-content'], $calls);
    }

    public function testStaleOriginalReturnsConflictWithoutMutationOrDiffWork(): void
    {
        $repository = $this->mock(DaemonFileRepository::class);
        $repository->shouldReceive('setServer')->once()->with($this->server)->andReturnSelf();
        $repository->shouldReceive('getContent')
            ->once()
            ->with('/server.properties', WriteFileWithDiffRequest::MAX_CONTENT_BYTES)
            ->andReturn('changed after preview');
        $repository->shouldNotReceive('putContent');

        $diff = $this->mock(FileDiffService::class);
        $diff->shouldNotReceive('isTextFile');
        $diff->shouldNotReceive('calculateDiff');

        $response = $this->actingAs($this->owner)->postJson(self::ENDPOINT, [
            'file' => '/server.properties',
            'content' => 'after',
            'original_content' => 'model supplied false original',
        ]);

        $response->assertConflict()->assertJsonPath('errors.0.code', 'FileContentConflict');
    }

    public function testDiffFailureLeavesTheDaemonUntouched(): void
    {
        $repository = $this->mock(DaemonFileRepository::class);
        $repository->shouldReceive('setServer')->once()->with($this->server)->andReturnSelf();
        $repository->shouldReceive('getContent')->once()->andReturn('before');
        $repository->shouldNotReceive('putContent');

        $diff = $this->mock(FileDiffService::class);
        $diff->shouldReceive('isTextFile')->once()->andReturnTrue();
        $diff->shouldReceive('calculateDiff')->once()->andThrow(new \RuntimeException('diff failed'));

        $this->withoutExceptionHandling();
        $this->expectException(\RuntimeException::class);

        $this->actingAs($this->owner)->postJson(self::ENDPOINT, [
            'file' => '/server.properties',
            'content' => 'after',
            'original_content' => 'before',
        ]);
    }

    private function fakeActivityLogger(): void
    {
        $activity = m::mock(ActivityLogService::class);
        $activity->shouldReceive('event')->once()->with('server:file.write')->andReturnSelf();
        $activity->shouldReceive('property')->twice()->andReturnSelf();
        $activity->shouldReceive('log')->once()->andReturnNull();

        Activity::swap($activity);
    }
}
