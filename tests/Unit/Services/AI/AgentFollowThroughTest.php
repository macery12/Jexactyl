<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Data\ProviderCapabilities;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/** Regression coverage for a real Qwen trajectory that ended on "I will…". */
class AgentFollowThroughTest extends TestCase
{
    public function testUnavailableCapabilityForcesAToolFreeConclusion(): void
    {
        config()->set('modules.ai.agent.max_steps', 5);
        config()->set('modules.ai.agent.reasoning', false);

        $provider = new ScriptedFollowThroughProvider([
            [
                AiStreamEvent::toolCall(new AiToolCall(
                    'missing-reinstall',
                    'load_tools',
                    ['tools' => ['reinstall'], 'reason' => 'The user selected reinstall'],
                )),
                AiStreamEvent::done(AiResponse::FINISH_TOOL_CALLS),
            ],
            [
                AiStreamEvent::text('Reinstall is not available to this assistant, so I did not change the server. Use the panel Reinstall action manually.'),
                AiStreamEvent::done(),
            ],
        ]);
        $this->app->instance(ProviderFactory::class, new ScriptedFollowThroughFactory($provider));

        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Capability boundary test';
        $server->setRelation('egg', null);
        $context = (new AgentContext(
            User::factory()->make(['id' => 7]),
            $server,
            'turn-capability-boundary',
        ))->withMessages([AiMessage::user('Reinstall it.')]);

        $events = [];
        app(AgentRunner::class)->run($context, static function (AgentEvent $event) use (&$events): void {
            $events[] = $event->toArray();
        });

        $this->assertCount(2, $provider->requests);
        $this->assertNotEmpty($provider->requests[0]->tools);
        $this->assertStringContainsString('Never invent `/root` or `/startup` prefixes', (string) $provider->requests[0]->systemPrompt);
        $this->assertSame([], $provider->requests[1]->tools);
        $this->assertStringContainsString('# Required conclusion', (string) $provider->requests[1]->systemPrompt);
        $this->assertTrue($this->hasDoneReason($events, 'capability_boundary'));
        $this->assertStringContainsString('did not change', (string) $context->messages[array_key_last($context->messages)]->content);
    }

    public function testQuestionLimitForcesAFinalAnswerInsteadOfAnotherQuestion(): void
    {
        config()->set('modules.ai.agent.max_steps', 4);
        config()->set('modules.ai.agent.reasoning', false);
        $provider = new ScriptedFollowThroughProvider([
            [
                AiStreamEvent::toolCall(new AiToolCall('extra-question', SharedTools::ASK_USER, [
                    'question' => 'Which option should I try now?',
                    'options' => [
                        ['label' => 'Reinstall'],
                        ['label' => 'More details'],
                    ],
                ])),
                AiStreamEvent::done(AiResponse::FINISH_TOOL_CALLS),
            ],
            [AiStreamEvent::text('I cannot ask another question in this turn, and no additional action was taken.'), AiStreamEvent::done()],
        ]);
        $this->app->instance(ProviderFactory::class, new ScriptedFollowThroughFactory($provider));

        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Question boundary test';
        $server->setRelation('egg', null);
        $context = (new AgentContext(User::factory()->make(['id' => 7]), $server, 'turn-question-boundary'))
            ->withMessages([AiMessage::user('Continue.')]);
        $context->questions = SharedTools::MAX_QUESTIONS_PER_TURN;

        $events = [];
        app(AgentRunner::class)->run($context, static function (AgentEvent $event) use (&$events): void {
            $events[] = $event->toArray();
        });

        $this->assertCount(2, $provider->requests);
        $this->assertSame([], $provider->requests[1]->tools);
        $this->assertTrue($this->hasDoneReason($events, 'capability_boundary'));
        $this->assertFalse($context->suspended);
    }

    public function testThirdConsecutiveDiscoveryCallForcesAConclusion(): void
    {
        config()->set('modules.ai.agent.max_steps', 6);
        config()->set('modules.ai.agent.reasoning', false);
        $provider = new ScriptedFollowThroughProvider([
            [AiStreamEvent::toolCall(new AiToolCall('search-1', SharedTools::SEARCH_TOOLS, ['query' => 'files'])), AiStreamEvent::done(AiResponse::FINISH_TOOL_CALLS)],
            [AiStreamEvent::toolCall(new AiToolCall('search-2', SharedTools::SEARCH_TOOLS, ['query' => 'backups'])), AiStreamEvent::done(AiResponse::FINISH_TOOL_CALLS)],
            [AiStreamEvent::toolCall(new AiToolCall('search-3', SharedTools::SEARCH_TOOLS, ['query' => 'startup'])), AiStreamEvent::done(AiResponse::FINISH_TOOL_CALLS)],
            [AiStreamEvent::text('I stopped searching and used the capability boundary already established.'), AiStreamEvent::done()],
        ]);
        $this->app->instance(ProviderFactory::class, new ScriptedFollowThroughFactory($provider));

        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Discovery boundary test';
        $server->setRelation('egg', null);
        $user = \Mockery::mock(User::class)->makePartial();
        $user->id = 7;
        $user->shouldReceive('can')->andReturn(true);
        $context = (new AgentContext($user, $server, 'turn-discovery-boundary'))
            ->withMessages([AiMessage::user('Find a way to do it.')]);

        $events = [];
        app(AgentRunner::class)->run($context, static function (AgentEvent $event) use (&$events): void {
            $events[] = $event->toArray();
        });

        $this->assertCount(4, $provider->requests, json_encode([
            'events' => $events,
            'messages' => array_map(static fn (AiMessage $message) => $message->toArray(), $context->messages),
        ], JSON_UNESCAPED_SLASHES) ?: 'Unable to encode trajectory.');
        $this->assertSame([], $provider->requests[3]->tools);
        $this->assertTrue($this->hasDoneReason($events, 'capability_boundary'));
    }

    public function testReasoningOnlyStopIsRetriedOnceWithoutReasoning(): void
    {
        config()->set('modules.ai.agent.max_steps', 3);
        config()->set('modules.ai.agent.reasoning', true);

        $provider = new ScriptedFollowThroughProvider([
            [
                AiStreamEvent::reasoning('I have enough evidence and should answer.'),
                AiStreamEvent::done(),
            ],
            [
                AiStreamEvent::text('The server is currently running.'),
                AiStreamEvent::done(),
            ],
        ]);
        $this->app->instance(ProviderFactory::class, new ScriptedFollowThroughFactory($provider));

        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Reasoning recovery test';
        $server->setRelation('egg', null);
        $context = (new AgentContext(
            User::factory()->make(['id' => 7]),
            $server,
            'turn-reasoning-recovery',
        ))->withMessages([AiMessage::user('Is it running?')]);

        $events = [];
        app(AgentRunner::class)->run($context, static function (AgentEvent $event) use (&$events): void {
            $events[] = $event->toArray();
        });

        $this->assertCount(2, $provider->requests);
        $this->assertTrue($provider->requests[0]->reasoning);
        $this->assertFalse($provider->requests[1]->reasoning);
        $this->assertTrue($this->hasDoneReason($events, 'complete'));
        $this->assertSame('The server is currently running.', $context->messages[array_key_last($context->messages)]->content);
    }

    public function testAnIntentionOnlyResponseIsRecoveredIntoAToolCallInsteadOfCompleting(): void
    {
        config()->set('modules.ai.agent.max_steps', 5);
        config()->set('modules.ai.agent.max_repairs', 2);
        config()->set('modules.ai.agent.reasoning', false);

        $provider = new ScriptedFollowThroughProvider([
            [
                AiStreamEvent::text('Next, I will inspect the startup tools.'),
                AiStreamEvent::done(),
            ],
            [
                AiStreamEvent::toolCall(new AiToolCall(
                    'recovered-call-1',
                    'search_tools',
                    ['query' => 'startup configuration'],
                )),
                AiStreamEvent::done(AiResponse::FINISH_TOOL_CALLS),
            ],
            [
                AiStreamEvent::text('The startup tools are available for the next diagnostic step.'),
                AiStreamEvent::done(),
            ],
        ]);

        $this->app->instance(ProviderFactory::class, new ScriptedFollowThroughFactory($provider));

        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Follow-through test';
        $server->setRelation('egg', null);

        $context = (new AgentContext(
            User::factory()->make(['id' => 7]),
            $server,
            'turn-follow-through',
        ))->withMessages([AiMessage::user('Inspect the available startup diagnostics.')]);

        $events = [];
        app(AgentRunner::class)->run(
            $context,
            static function (AgentEvent $event) use (&$events): void {
                $events[] = $event->toArray();
            },
        );

        $this->assertCount(3, $provider->requests);
        $this->assertNull($provider->requests[0]->responseSchema);
        $this->assertNotNull($provider->requests[1]->responseSchema);
        $this->assertSame(AiRequest::TOOL_CHOICE_REQUIRED, $provider->requests[1]->toolChoice);
        $this->assertNull($provider->requests[2]->responseSchema);

        $repairMessage = $provider->requests[1]->messages[array_key_last($provider->requests[1]->messages)];
        $this->assertSame(AiMessage::ROLE_USER, $repairMessage->role);
        $this->assertStringContainsString('announced a next action', (string) $repairMessage->content);

        $this->assertTrue($this->hasEvent($events, 'tool_call', 'search_tools'));
        $this->assertTrue($this->hasEvent($events, 'tool_result', 'search_tools'));
        $this->assertTrue($this->hasDoneReason($events, 'complete'));
        $this->assertSame(2, $context->step);
        $this->assertSame(1, $context->repairs);
    }

    /** @param array<int, array<string, mixed>> $events */
    private function hasEvent(array $events, string $type, string $tool): bool
    {
        foreach ($events as $event) {
            if (($event['type'] ?? null) === $type && ($event['tool'] ?? null) === $tool) {
                return true;
            }
        }

        return false;
    }

    /** @param array<int, array<string, mixed>> $events */
    private function hasDoneReason(array $events, string $reason): bool
    {
        foreach ($events as $event) {
            if (($event['type'] ?? null) === 'done' && ($event['reason'] ?? null) === $reason) {
                return true;
            }
        }

        return false;
    }
}

class ScriptedFollowThroughFactory extends ProviderFactory
{
    public function __construct(private readonly AiProvider $provider)
    {
    }

    public function make(?int $timeoutSeconds = null): AiProvider
    {
        return $this->provider;
    }

    public function systemPrompt(): string
    {
        return '';
    }
}

class ScriptedFollowThroughProvider implements AiProvider
{
    /** @var AiRequest[] */
    public array $requests = [];

    private int $cursor = 0;

    /** @param array<int, array<int, AiStreamEvent>> $scripts */
    public function __construct(private readonly array $scripts)
    {
    }

    public function chat(AiRequest $request): AiResponse
    {
        return new AiResponse(null);
    }

    public function stream(AiRequest $request): \Generator
    {
        $this->requests[] = $request;
        $events = $this->scripts[$this->cursor++] ?? [];

        foreach ($events as $event) {
            yield $event;
        }
    }

    public function capabilities(?string $model = null): ProviderCapabilities
    {
        return new ProviderCapabilities(supportsTools: true, supportsStructuredOutput: true);
    }

    public function listModels(): array
    {
        return [];
    }

    public function health(): bool
    {
        return true;
    }

    public function config(): ProviderConfig
    {
        return new ProviderConfig(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE, 'http://localhost/v1');
    }
}
