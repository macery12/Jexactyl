<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\AgentEvent;
use GuzzleHttp\Exception\ClientException;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;
use Everest\Exceptions\Http\Connection\DaemonConnectionException;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class AgentFileApprovalIntegrityTest extends TestCase
{
    public function testModelFacingWriteSchemaDoesNotEchoTheLiveOriginal(): void
    {
        $definition = app(ToolRegistry::class)->find('files_write');

        $this->assertSame(['file', 'content'], $definition->parameters['required']);
        $this->assertArrayNotHasKey('original_content', $definition->parameters['properties']);
        $this->assertContains('original_content', $definition->bodyFields);
    }

    public function testFileWriteCannotBeDowngradedBelowApproval(): void
    {
        try {
            Setting::set('settings::modules:ai:risk_overrides', json_encode(['files_write' => 'safe']));
            $definition = app(ToolRegistry::class)->find('files_write');

            $this->assertSame('write', app(RiskGate::class)->resolve($definition));
        } finally {
            Setting::forget('settings::modules:ai:risk_overrides');
        }
    }

    public function testModelSuppliedOriginalIsReplacedByLiveServerContent(): void
    {
        $user = new User();
        $server = (new Server())->forceFill([
            'uuid' => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            'name' => 'Live server',
        ]);
        $context = new AgentContext($user, $server, 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff');
        $definition = app(ToolRegistry::class)->find('files_write');

        $files = \Mockery::mock(DaemonFileRepository::class);
        $files->shouldReceive('setServer')->once()->with($server)->andReturnSelf();
        $files->shouldReceive('getContent')
            ->once()
            ->with('/server.properties', WriteFileWithDiffRequest::MAX_CONTENT_BYTES)
            ->andReturn("motd=Héllo 🌍\n");
        $this->app->instance(DaemonFileRepository::class, $files);

        $method = new \ReflectionMethod(AgentRunner::class, 'attestApprovalArguments');
        $attested = $method->invoke(app(AgentRunner::class), $context, $definition, [
            'file' => '/server.properties',
            'original_content' => 'fake no-op',
            'content' => "motd=Nouveau 🧱\n",
        ]);

        $this->assertSame("motd=Héllo 🌍\n", $attested['original_content']);
        $this->assertSame("motd=Nouveau 🧱\n", $attested['content']);
    }

    public function testBinaryAndArchiveTargetsAreRefusedBeforeAttestationOrApproval(): void
    {
        $files = \Mockery::mock(DaemonFileRepository::class);
        $files->shouldNotReceive('setServer');
        $files->shouldNotReceive('getContent');
        $this->app->instance(DaemonFileRepository::class, $files);

        $runner = app(AgentRunner::class);
        $definition = app(ToolRegistry::class)->find('files_write');
        $method = new \ReflectionMethod(AgentRunner::class, 'handleCall');

        $runtimeTargets = [
            '/server.JAR',
            '/archive.zip',
            '/archive.tar',
            '/archive.gz',
            '/archive.tgz',
            '/archive.7z',
            '/archive.rar',
            '/program.exe',
            '/library.dll',
            '/library.so',
            '/payload.bin',
        ];
        $genericTargets = [
            '/image.png',
            '/world/player.dat',
            '/world/region/r.0.0.mca',
            '/plugins/database.db',
            '/unknown-extensionless-file',
        ];

        foreach (array_merge($runtimeTargets, $genericTargets) as $index => $target) {
            $server = (new Server())->forceFill([
                'uuid' => 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
                'name' => 'Incomplete server',
            ]);
            $context = new AgentContext(new User(), $server, 'bbbbbbbb-cccc-4ddd-8eee-' . str_pad((string) $index, 12, '0', STR_PAD_LEFT));
            $events = [];

            $outcome = $method->invoke(
                $runner,
                $context,
                new ToolCallData('call-' . $index, 'files_write', [
                    'file' => $target,
                    'content' => 'JV1JLkNvbnRlbnQK',
                ]),
                [$definition],
                function (AgentEvent $event) use (&$events): void {
                    $events[] = $event;
                },
            );

            $message = $context->messages[array_key_last($context->messages)];
            $payload = json_decode((string) $message->content, true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame('continued', $outcome);
            $this->assertSame('binary_write_unsupported', $payload['error']);
            $this->assertFalse($payload['retryable']);
            $this->assertStringContainsString('Do not retry files_write', $payload['next']);
            if (in_array($target, $runtimeTargets, true)) {
                $this->assertSame(['restore_backup', 'server_reinstall'], array_column($payload['requires'], 'action'));
            } else {
                $encoded = strtolower(json_encode($payload));
                $this->assertArrayNotHasKey('requires', $payload);
                $this->assertStringNotContainsString('backup', $encoded);
                $this->assertStringNotContainsString('reinstall', $encoded);
            }
            $this->assertSame(
                [AgentEvent::TYPE_TOOL_RESULT],
                array_map(fn (AgentEvent $event) => $event->type, $events),
                'A refused binary target must close its pending row without reaching the tool-call or approval boundary.',
            );
        }
    }

    public function testProposedContentMustBeActualUtf8TextBeforeAttestation(): void
    {
        $files = \Mockery::mock(DaemonFileRepository::class);
        $files->shouldNotReceive('setServer');
        $files->shouldNotReceive('getContent');
        $this->app->instance(DaemonFileRepository::class, $files);

        $runner = app(AgentRunner::class);
        $definition = app(ToolRegistry::class)->find('files_write');
        $method = new \ReflectionMethod(AgentRunner::class, 'handleCall');

        foreach (["motd=hello\0hidden", "motd=\xC3\x28"] as $index => $content) {
            $server = (new Server())->forceFill([
                'uuid' => 'dddddddd-eeee-4fff-8000-111111111111',
                'name' => 'Text server',
            ]);
            $context = new AgentContext(new User(), $server, 'dddddddd-eeee-4fff-8000-' . str_pad((string) $index, 12, '0', STR_PAD_LEFT));
            $events = [];

            $outcome = $method->invoke(
                $runner,
                $context,
                new ToolCallData('call-content-' . $index, 'files_write', [
                    'file' => '/server.properties',
                    'content' => $content,
                ]),
                [$definition],
                function (AgentEvent $event) use (&$events): void {
                    $events[] = $event;
                },
            );

            $message = $context->messages[array_key_last($context->messages)];
            $payload = json_decode((string) $message->content, true, flags: JSON_THROW_ON_ERROR);

            $this->assertSame('continued', $outcome);
            $this->assertSame('binary_write_unsupported', $payload['error']);
            $this->assertFalse($payload['retryable']);
            $encoded = strtolower(json_encode($payload));
            $this->assertArrayNotHasKey('requires', $payload);
            $this->assertStringNotContainsString('backup', $encoded);
            $this->assertStringNotContainsString('reinstall', $encoded);
            $this->assertSame([AgentEvent::TYPE_TOOL_RESULT], array_map(fn (AgentEvent $event) => $event->type, $events));
        }
    }

    public function testLiveOriginalMustBeActualUtf8TextBeforeApproval(): void
    {
        $definition = app(ToolRegistry::class)->find('files_write');
        $method = new \ReflectionMethod(AgentRunner::class, 'handleCall');

        foreach (["SQLite format 3\0binary", "invalid=\xC3\x28"] as $index => $liveContent) {
            $server = (new Server())->forceFill([
                'uuid' => 'eeeeeeee-ffff-4000-8111-222222222222',
                'name' => 'Disguised binary',
            ]);
            $context = new AgentContext(new User(), $server, 'eeeeeeee-ffff-4000-8111-' . str_pad((string) $index, 12, '0', STR_PAD_LEFT));

            $files = \Mockery::mock(DaemonFileRepository::class);
            $files->shouldReceive('setServer')->once()->with($server)->andReturnSelf();
            $files->shouldReceive('getContent')
                ->once()
                ->with('/server.properties', WriteFileWithDiffRequest::MAX_CONTENT_BYTES)
                ->andReturn($liveContent);
            $this->app->instance(DaemonFileRepository::class, $files);

            $events = [];
            $outcome = $method->invoke(
                app(AgentRunner::class),
                $context,
                new ToolCallData('call-live-' . $index, 'files_write', [
                    'file' => '/server.properties',
                    'content' => "motd=valid UTF-8 🧱\n",
                ]),
                [$definition],
                function (AgentEvent $event) use (&$events): void {
                    $events[] = $event;
                },
            );

            $message = $context->messages[array_key_last($context->messages)];
            $payload = json_decode((string) $message->content, true, flags: JSON_THROW_ON_ERROR);
            $eventTypes = array_map(fn (AgentEvent $event) => $event->type, $events);

            $this->assertSame('continued', $outcome);
            $this->assertSame('binary_write_unsupported', $payload['error']);
            $this->assertFalse($payload['retryable']);
            $encoded = strtolower(json_encode($payload));
            $this->assertArrayNotHasKey('requires', $payload);
            $this->assertStringNotContainsString('backup', $encoded);
            $this->assertStringNotContainsString('reinstall', $encoded);
            $this->assertContains(AgentEvent::TYPE_TOOL_RESULT, $eventTypes);
            $this->assertNotContains(AgentEvent::TYPE_APPROVAL_REQUIRED, $eventTypes);
        }
    }

    public function testMissingTextTargetReturnsRecoveryGuidanceInsteadOfThrowing(): void
    {
        $user = new User();
        $server = (new Server())->forceFill([
            'uuid' => 'cccccccc-dddd-4eee-8fff-000000000000',
            'name' => 'Incomplete server',
        ]);
        $context = new AgentContext($user, $server, 'cccccccc-dddd-4eee-8fff-111111111111');
        $definition = app(ToolRegistry::class)->find('files_write');

        $missing = new DaemonConnectionException(new ClientException(
            'Missing file',
            new Request('GET', '/api/servers/example/files/contents'),
            new Response(404, [], json_encode(['error' => 'File not found.'])),
        ));

        $files = \Mockery::mock(DaemonFileRepository::class);
        $files->shouldReceive('setServer')->once()->with($server)->andReturnSelf();
        $files->shouldReceive('getContent')
            ->once()
            ->with('/server.properties', WriteFileWithDiffRequest::MAX_CONTENT_BYTES)
            ->andThrow($missing);
        $this->app->instance(DaemonFileRepository::class, $files);

        $events = [];
        $method = new \ReflectionMethod(AgentRunner::class, 'handleCall');
        $outcome = $method->invoke(
            app(AgentRunner::class),
            $context,
            new ToolCallData('call-missing', 'files_write', [
                'file' => '/server.properties',
                'content' => "motd=Hello\n",
            ]),
            [$definition],
            function (AgentEvent $event) use (&$events): void {
                $events[] = $event;
            },
        );

        $message = $context->messages[array_key_last($context->messages)];
        $payload = json_decode((string) $message->content, true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame('continued', $outcome);
        $this->assertSame('file_missing', $payload['error']);
        $this->assertFalse($payload['retryable']);
        $this->assertSame(['verify_path'], array_column($payload['requires'], 'action'));
        $this->assertSame('files_list', $payload['requires'][0]['tool']);
        $this->assertSame('/', $payload['requires'][0]['directory']);
        $this->assertStringContainsString('cannot create a missing file', $payload['next']);
        $this->assertStringNotContainsString('backup', json_encode($payload));
        $this->assertStringNotContainsString('reinstall', strtolower(json_encode($payload)));
        $eventTypes = array_map(fn (AgentEvent $event) => $event->type, $events);
        $this->assertContains(AgentEvent::TYPE_TOOL_RESULT, $eventTypes);
        $this->assertNotContains(AgentEvent::TYPE_APPROVAL_REQUIRED, $eventTypes);
    }
}
