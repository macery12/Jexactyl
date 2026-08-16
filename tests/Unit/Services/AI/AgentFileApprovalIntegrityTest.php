<?php

namespace Everest\Tests\Unit\Services\AI;

use Mockery;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class AgentFileApprovalIntegrityTest extends TestCase
{
    public function testModelSuppliedOriginalIsReplacedByLiveServerContent(): void
    {
        $user = new User();
        $server = (new Server())->forceFill([
            'uuid' => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            'name' => 'Live server',
        ]);
        $context = new AgentContext($user, $server, 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff');
        $definition = app(ToolRegistry::class)->find('files_write');

        $files = Mockery::mock(DaemonFileRepository::class);
        $files->shouldReceive('setServer')->once()->with($server)->andReturnSelf();
        $files->shouldReceive('getContent')
            ->once()
            ->with('/server.properties', WriteFileWithDiffRequest::MAX_CONTENT_BYTES)
            ->andReturn("motd=real live value\n");
        $this->app->instance(DaemonFileRepository::class, $files);

        $method = new \ReflectionMethod(AgentRunner::class, 'attestApprovalArguments');
        $attested = $method->invoke(app(AgentRunner::class), $context, $definition, [
            'file' => '/server.properties',
            'original_content' => 'fake no-op',
            'content' => 'fake no-op',
        ]);

        $this->assertSame("motd=real live value\n", $attested['original_content']);
        $this->assertSame('fake no-op', $attested['content']);
    }
}
