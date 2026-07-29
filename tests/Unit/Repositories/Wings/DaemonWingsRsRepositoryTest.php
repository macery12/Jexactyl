<?php

namespace Everest\Tests\Unit\Repositories\Wings;

use GuzzleHttp\Client;
use Everest\Models\Node;
use GuzzleHttp\Middleware;
use Everest\Tests\TestCase;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Handler\MockHandler;
use Illuminate\Contracts\Foundation\Application;
use Everest\Repositories\Wings\DaemonWingsRsRepository;

class DaemonWingsRsRepositoryTest extends TestCase
{
    private array $history = [];

    public function testUpgradeReturnsDaemonAppliedStateAndUsesTrustedPayloadFields(): void
    {
        config()->set('everest.wings_rs.restart_command', 'rc-service');
        config()->set('everest.wings_rs.restart_command_args', ['wings', 'restart']);

        $repository = $this->repositoryWithResponse(['applied' => true]);

        $this->assertTrue($repository->upgradeSystem(
            'https://releases.example.test/wings',
            str_repeat('a', 64)
        ));

        $requestPayload = json_decode((string) $this->history[0]['request']->getBody(), false);
        $this->assertEquals([
            'url' => 'https://releases.example.test/wings',
            'headers' => (object) [],
            'sha256' => str_repeat('a', 64),
            'restart_command' => 'rc-service',
            'restart_command_args' => ['wings', 'restart'],
        ], (array) $requestPayload);
    }

    public function testUpgradeReturnsFalseWhenDaemonIgnoresPanelUpgrades(): void
    {
        $repository = $this->repositoryWithResponse(['applied' => false]);

        $this->assertFalse($repository->upgradeSystem(
            'https://releases.example.test/wings',
            str_repeat('b', 64)
        ));
    }

    public function testUpgradeRejectsMalformedDaemonResponse(): void
    {
        $repository = $this->repositoryWithResponse(['success' => true]);

        $this->expectException(\UnexpectedValueException::class);
        $this->expectExceptionMessage('invalid upgrade response');

        $repository->upgradeSystem(
            'https://releases.example.test/wings',
            str_repeat('c', 64)
        );
    }

    private function repositoryWithResponse(array $payload): DaemonWingsRsRepository
    {
        $this->history = [];
        $stack = HandlerStack::create(new MockHandler([
            new Response(
                200,
                ['Content-Type' => 'application/json'],
                json_encode($payload, JSON_THROW_ON_ERROR)
            ),
        ]));
        $stack->push(Middleware::history($this->history));
        $client = new Client([
            'handler' => $stack,
            'base_uri' => 'https://wings.example.test',
        ]);

        $node = new Node();
        $node->wings_type = Node::WINGS_TYPE_RS;
        $repository = new TestDaemonWingsRsRepository($this->app, $client);
        $repository->setNode($node);

        return $repository;
    }
}

final class TestDaemonWingsRsRepository extends DaemonWingsRsRepository
{
    public function __construct(Application $app, private Client $client)
    {
        parent::__construct($app);
    }

    public function getHttpClient(array $headers = []): Client
    {
        return $this->client;
    }
}
