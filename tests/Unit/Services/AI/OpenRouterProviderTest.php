<?php

namespace Everest\Tests\Unit\Services\AI;

use GuzzleHttp\Middleware;
use Everest\Tests\TestCase;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Handler\MockHandler;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Data\AiTool;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Data\ProviderConfig;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Providers\OpenRouterProvider;

class OpenRouterProviderTest extends TestCase
{
    /** @var array<int, array> */
    private array $history = [];

    private function provider(array $responses): OpenRouterProvider
    {
        $this->history = [];
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));

        return new OpenRouterProvider(new ProviderConfig(
            provider: ProviderConfig::PROVIDER_OPENROUTER,
            endpoint: OpenRouterProvider::ENDPOINT,
            apiKey: 'sk-or-v1-test-secret',
            model: OpenRouterProvider::MODEL,
            maxTokens: 512,
            temperature: 0.2,
            systemPrompt: 'You are a test.',
        ), $stack);
    }

    private function payload(int $index = 0): array
    {
        return json_decode((string) $this->history[$index]['request']->getBody(), true) ?? [];
    }

    public function testFactoryCanonicalizesEndpointAndModelForEveryInputSource(): void
    {
        $provider = (new ProviderFactory())->fromConfig(new ProviderConfig(
            ProviderConfig::PROVIDER_OPENROUTER,
            'https://attacker.example/v1',
            'secret',
            'paid/model',
        ));

        $this->assertInstanceOf(OpenRouterProvider::class, $provider);
        $this->assertSame(OpenRouterProvider::ENDPOINT, $provider->config()->endpoint);
        $this->assertSame(OpenRouterProvider::MODEL, $provider->config()->model);
        $this->assertSame('secret', $provider->config()->apiKey);
        $this->assertFalse($provider->config()->isSelfHosted());
        $this->assertTrue($provider->config()->requiresApiKey());

        $settingsFactory = new class (['provider' => 'openrouter', 'endpoint' => 'https://stale.example/v1', 'model' => 'stale/model']) extends ProviderFactory {
            public function __construct(private array $values)
            {
            }

            protected function setting(string $key, mixed $default = null): mixed
            {
                return $this->values[$key] ?? $default;
            }
        };

        $this->assertSame(OpenRouterProvider::ENDPOINT, $settingsFactory->config()->endpoint);
        $this->assertSame(OpenRouterProvider::MODEL, $settingsFactory->config()->model);
    }

    public function testRequestForcesFreeRouterPrivacyParametersAndPreservesReasoningDetails(): void
    {
        $details = [
            [
                'type' => 'reasoning.encrypted',
                'data' => 'opaque-ciphertext',
                'id' => 'reasoning-1',
                'format' => 'anthropic-claude-v1',
                'index' => 0,
            ],
            [
                'type' => 'reasoning.summary',
                'summary' => 'Need both files.',
                'id' => 'reasoning-2',
                'format' => 'anthropic-claude-v1',
                'index' => 1,
            ],
        ];
        $sse = implode('', [
            'data: ' . json_encode(['choices' => [['delta' => ['reasoning' => 'thinking ', 'reasoning_details' => [$details[0]]]]]]) . "\n\n",
            'data: ' . json_encode(['choices' => [['delta' => ['reasoning_details' => [$details[1]]]]]]) . "\n\n",
            'data: ' . json_encode(['choices' => [['delta' => ['tool_calls' => [[
                'index' => 0,
                'id' => 'call_1',
                'function' => ['name' => 'files_read', 'arguments' => '{"path":"/a"}'],
            ], [
                'index' => 1,
                'id' => 'call_2',
                'function' => ['name' => 'files_read', 'arguments' => '{"path":"/b"}'],
            ]]]]]]) . "\n\n",
            'data: ' . json_encode(['choices' => [['delta' => [], 'finish_reason' => 'tool_calls']]]) . "\n\n",
            'data: ' . json_encode(['usage' => ['prompt_tokens' => 20, 'completion_tokens' => 7, 'total_tokens' => 27]]) . "\n\n",
            "data: [DONE]\n\n",
        ]);
        $provider = $this->provider([new Response(200, [], $sse)]);
        $tool = new AiTool('files_read', 'Read a file', [
            'type' => 'object',
            'properties' => ['path' => ['type' => 'string']],
            'required' => ['path'],
        ]);

        $events = iterator_to_array($provider->stream(new AiRequest(
            messages: [
                AiMessage::user('typed user content stays unchanged'),
                AiMessage::assistant(null, [new AiToolCall('prior', 'files_read', ['path' => '/old'])], $details),
                AiMessage::tool('prior', 'files_read', '{"email":"[email_abcd12]"}'),
            ],
            tools: [$tool],
            model: 'attempted/override',
            noCache: true,
            reasoning: true,
        )));

        $request = $this->history[0]['request'];
        $payload = $this->payload();
        $this->assertSame('/api/v1/chat/completions', $request->getUri()->getPath());
        $this->assertSame('Bearer sk-or-v1-test-secret', $request->getHeaderLine('Authorization'));
        $this->assertSame(OpenRouterProvider::MODEL, $payload['model']);
        $this->assertSame(['data_collection' => 'deny', 'require_parameters' => true], $payload['provider']);
        $this->assertSame(['enabled' => true], $payload['reasoning']);
        $this->assertTrue($payload['stream_options']['include_usage']);
        $this->assertSame('files_read', $payload['tools'][0]['function']['name']);
        $this->assertSame($details, $payload['messages'][2]['reasoning_details']);
        $this->assertSame('typed user content stays unchanged', $payload['messages'][1]['content']);

        $reasoning = array_values(array_filter($events, fn ($event) => $event->type === AiStreamEvent::TYPE_REASONING_BLOCK));
        $usage = array_values(array_filter($events, fn ($event) => $event->type === AiStreamEvent::TYPE_USAGE));
        $calls = array_values(array_filter($events, fn ($event) => $event->type === AiStreamEvent::TYPE_TOOL_CALL));
        $this->assertSame($details, array_map(fn ($event) => $event->reasoningBlock, $reasoning));
        $this->assertSame(27, $usage[0]->usage['total_tokens']);
        $this->assertCount(2, $calls);
        $this->assertSame('files_read', $calls[0]->toolCall->name);
    }

    public function testHealthUsesCurrentKeyAndExactFreeRouterMetadataThenCachesCapabilities(): void
    {
        Cache::flush();
        $provider = $this->provider([
            new Response(200, [], json_encode(['data' => ['label' => 'sk-or-v1-...test', 'is_free_tier' => true]])),
            new Response(200, [], json_encode(['data' => [
                'id' => OpenRouterProvider::MODEL,
                'context_length' => 200000,
                'supported_parameters' => ['tools', 'tool_choice', 'response_format', 'structured_outputs', 'reasoning', 'temperature'],
            ]])),
        ]);

        $this->assertTrue($provider->health());
        $capabilities = $provider->capabilities();

        $this->assertSame(['/api/v1/key', '/api/v1/model/openrouter/free'], array_map(
            fn (array $entry): string => $entry['request']->getUri()->getPath(),
            $this->history,
        ));
        $this->assertTrue($capabilities->supportsTools);
        $this->assertTrue($capabilities->supportsStructuredOutput);
        $this->assertTrue($capabilities->supportsReasoning);
        $this->assertFalse($capabilities->selfHosted);
        $this->assertSame(200000, $capabilities->maxContextTokens);
        $this->assertCount(2, $this->history, 'Capabilities should reuse the exact metadata health cached.');
        $this->assertSame([['id' => OpenRouterProvider::MODEL, 'size' => null]], $provider->listModels());
    }

    public function testHealthReportsRevokedKeysWithoutGeneration(): void
    {
        $provider = $this->provider([new Response(401, [], json_encode([
            'error' => ['message' => 'credential echoed here', 'metadata' => ['error_type' => 'authentication']],
        ]))]);

        $this->assertFalse($provider->health());
        $this->assertSame(OpenRouterProvider::INVALID_KEY_MESSAGE, $provider->lastFailure());
        $this->assertCount(1, $this->history);
        $this->assertSame('/api/v1/key', $this->history[0]['request']->getUri()->getPath());
    }

    public function testTransportLogsContainNoProviderBodyPromptOrCredential(): void
    {
        Log::shouldReceive('error')->once()->with('AI provider transport error', \Mockery::on(
            static fn (array $context): bool => $context['provider'] === ProviderConfig::PROVIDER_OPENROUTER
                && $context['status'] === 503
                && !str_contains((string) json_encode($context), 'provider-secret')
                && !str_contains((string) json_encode($context), 'prompt-secret')
                && !str_contains((string) json_encode($context), 'sk-or-v1-test-secret')
        ));
        $provider = $this->provider([new Response(503, [], json_encode([
            'error' => ['message' => 'provider-secret', 'metadata' => ['error_type' => 'provider_unavailable']],
        ]))]);

        try {
            $provider->chat(new AiRequest([AiMessage::user('prompt-secret')], noCache: true));
            $this->fail('The provider request should fail.');
        } catch (AIServiceException $exception) {
            $this->assertSame(OpenRouterProvider::TEMPORARILY_UNAVAILABLE_MESSAGE, $exception->getMessage());
        }
    }

    #[DataProvider('failureResponses')]
    public function testFailuresAreMappedWithoutExposingProviderControlledText(Response $response, string $expected): void
    {
        $provider = $this->provider([$response]);

        try {
            $provider->chat(new AiRequest([AiMessage::user('sensitive-prompt')], noCache: true));
            $this->fail('The OpenRouter request should fail.');
        } catch (AIServiceException $exception) {
            $this->assertSame($expected, $exception->getMessage());
            $this->assertStringNotContainsString('provider-secret', $exception->getMessage());
            $this->assertStringNotContainsString('sensitive-prompt', $exception->getMessage());
        }
    }

    public static function failureResponses(): array
    {
        $typed = static fn (string $type): string => json_encode([
            'error' => ['message' => 'provider-secret', 'metadata' => ['error_type' => $type]],
        ]);

        return [
            'revoked key' => [new Response(401, [], $typed('authentication')), OpenRouterProvider::INVALID_KEY_MESSAGE],
            'spending limit' => [new Response(402, [], $typed('payment_required')), OpenRouterProvider::CREDITS_MESSAGE],
            'moderation' => [new Response(200, [], $typed('content_policy_violation')), OpenRouterProvider::POLICY_MESSAGE],
            'no eligible free model' => [new Response(200, [], $typed('not_found')), OpenRouterProvider::NO_ELIGIBLE_MODEL_MESSAGE],
            'context too large' => [new Response(413, [], $typed('context_length_exceeded')), OpenRouterProvider::PAYLOAD_TOO_LARGE_MESSAGE],
            'overloaded in HTTP 200' => [new Response(200, [], $typed('provider_overloaded')), OpenRouterProvider::TEMPORARILY_UNAVAILABLE_MESSAGE],
            'unrecognized status is not interpreted' => [new Response(418, [], $typed('unknown_future_type')), OpenRouterProvider::PROVIDER_REJECTED_MESSAGE],
            'malformed JSON' => [new Response(200, [], '{broken'), OpenRouterProvider::INVALID_RESPONSE_MESSAGE],
            'rate limit with valid retry after' => [
                new Response(429, ['Retry-After' => '90'], $typed('rate_limit_exceeded')),
                OpenRouterProvider::RATE_LIMIT_MESSAGE . ' Try again in 2 minutes.',
            ],
        ];
    }

    #[DataProvider('badStreams')]
    public function testMalformedAndIncompleteStreamsAreRejected(string $body, string $expected): void
    {
        $provider = $this->provider([new Response(200, [], $body)]);

        $this->expectException(AIServiceException::class);
        $this->expectExceptionMessage($expected);

        iterator_to_array($provider->stream(new AiRequest([AiMessage::user('secret')], noCache: true)));
    }

    public static function badStreams(): array
    {
        $frame = static fn (array $data): string => 'data: ' . json_encode($data) . "\n\n";

        return [
            'top-level SSE error' => [
                $frame(['error' => ['message' => 'secret', 'metadata' => ['error_type' => 'provider_unavailable']]]),
                OpenRouterProvider::TEMPORARILY_UNAVAILABLE_MESSAGE,
            ],
            'nested choice error' => [
                $frame(['choices' => [['error' => ['metadata' => ['error_type' => 'content_policy_violation']]]]]),
                OpenRouterProvider::POLICY_MESSAGE,
            ],
            'error finish reason' => [
                $frame(['choices' => [['delta' => [], 'finish_reason' => 'error', 'error' => ['metadata' => ['error_type' => 'timeout']]]]]),
                OpenRouterProvider::TEMPORARILY_UNAVAILABLE_MESSAGE,
            ],
            'interrupted after content' => [
                $frame(['choices' => [['delta' => ['content' => 'partial']]]]),
                OpenRouterProvider::INTERRUPTED_STREAM_MESSAGE,
            ],
            'empty completion' => [
                $frame(['choices' => [['delta' => [], 'finish_reason' => 'stop']]]) . "data: [DONE]\n\n",
                OpenRouterProvider::EMPTY_RESPONSE_MESSAGE,
            ],
            'malformed JSON' => [
                "data: {broken\n\ndata: [DONE]\n\n",
                OpenRouterProvider::INVALID_RESPONSE_MESSAGE,
            ],
        ];
    }
}
