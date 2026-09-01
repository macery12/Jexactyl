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
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Data\ProviderConfig;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Providers\AbstractProvider;
use Everest\Services\AI\Inference\ProviderReadiness;
use Everest\Services\AI\Providers\AnthropicProvider;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Providers\OpenAiCompatibleProvider;

/**
 * Exercises each driver's wire format against a mocked transport, so the
 * request the panel actually sends is asserted rather than the driver's
 * internals.
 */
class ProviderDriverTest extends TestCase
{
    /** @var array<int, array> */
    private array $history = [];

    protected function stack(array $responses): HandlerStack
    {
        $this->history = [];
        $stack = HandlerStack::create(new MockHandler($responses));
        $stack->push(Middleware::history($this->history));

        return $stack;
    }

    private function sentPayload(int $index = 0): array
    {
        return json_decode((string) $this->history[$index]['request']->getBody(), true) ?? [];
    }

    private function sentPath(int $index = 0): string
    {
        return $this->history[$index]['request']->getUri()->getPath();
    }

    private function tool(): AiTool
    {
        return new AiTool('files_read', 'Read a file', [
            'type' => 'object',
            'properties' => ['path' => ['type' => 'string']],
            'required' => ['path'],
        ]);
    }

    public function testEveryProviderTransportsTheSameCompleteToolContracts(): void
    {
        $tools = [
            $this->tool(),
            new AiTool('server_status', 'Read server status', AiTool::emptySchema()),
        ];
        $request = new AiRequest(
            messages: [AiMessage::user('inspect the server')],
            tools: $tools,
            noCache: true,
        );

        $ollama = new OllamaProvider(
            $this->config(ProviderConfig::PROVIDER_OLLAMA),
            $this->stack([new Response(200, [], json_encode([
                'message' => ['role' => 'assistant', 'content' => 'ok'],
                'done' => true,
            ]))]),
        );
        $ollama->chat($request);
        $ollamaTools = array_map(
            static fn (array $tool): array => $tool['function'],
            $this->sentPayload()['tools'],
        );

        $openAi = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI, [
                'endpoint' => 'https://api.openai.com/v1',
                'apiKey' => 'sk-test',
            ]),
            $this->stack([new Response(200, [], json_encode([
                'choices' => [[
                    'message' => ['content' => 'ok'],
                    'finish_reason' => 'stop',
                ]],
            ]))]),
        );
        $openAi->chat($request);
        $openAiTools = array_map(
            static fn (array $tool): array => $tool['function'],
            $this->sentPayload()['tools'],
        );

        $anthropic = new AnthropicProvider(
            $this->config(ProviderConfig::PROVIDER_ANTHROPIC, [
                'endpoint' => 'https://api.anthropic.com/v1',
                'apiKey' => 'sk-ant-test',
            ]),
            $this->stack([new Response(200, [], json_encode([
                'content' => [['type' => 'text', 'text' => 'ok']],
                'stop_reason' => 'end_turn',
            ]))]),
        );
        $anthropic->chat($request);
        $anthropicTools = array_map(static fn (array $tool): array => [
            'name' => $tool['name'],
            'description' => $tool['description'],
            'parameters' => $tool['input_schema'],
        ], $this->sentPayload()['tools']);

        $this->assertSame($ollamaTools, $openAiTools);
        $this->assertSame($openAiTools, $anthropicTools);
        $this->assertSame(['files_read', 'server_status'], array_column($anthropicTools, 'name'));
    }

    public function testTransportErrorsDoNotLogOrExposeProviderBodies(): void
    {
        Log::shouldReceive('error')
            ->once()
            ->with('AI provider transport error', \Mockery::on(
                fn (array $context): bool => $context['provider'] === ProviderConfig::PROVIDER_OPENAI_COMPATIBLE
                    && $context['status'] === 500
                    && !str_contains((string) json_encode($context), 'prompt-secret')
            ));

        $stack = $this->stack([
            new Response(500, [], json_encode([
                'error' => ['message' => 'echoed prompt-secret and tool output'],
            ])),
        ]);
        $provider = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE, ['endpoint' => 'https://provider.test/v1']),
            $stack,
        );

        try {
            $provider->chat(new AiRequest([AiMessage::user('prompt-secret')]));
            $this->fail('The failed provider request should throw.');
        } catch (AIServiceException $exception) {
            $this->assertSame(ProviderReadiness::UNREACHABLE_MESSAGE, $exception->getMessage());
            $this->assertStringNotContainsString('prompt-secret', $exception->getMessage());
        }
    }

    public function testStreamingProviderErrorsDoNotExposeProviderMessages(): void
    {
        $body = 'data: ' . json_encode([
            'error' => ['message' => 'echoed prompt-secret and tool output'],
        ]) . "\n\n";
        $provider = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE, ['endpoint' => 'https://provider.test/v1']),
            $this->stack([new Response(200, [], $body)]),
        );

        try {
            iterator_to_array($provider->stream(new AiRequest([AiMessage::user('prompt-secret')])));
            $this->fail('The provider error frame should throw.');
        } catch (AIServiceException $exception) {
            $this->assertSame(AbstractProvider::PROVIDER_REJECTED_MESSAGE, $exception->getMessage());
            $this->assertStringNotContainsString('prompt-secret', $exception->getMessage());
        }
    }

    #[DataProvider('providerHttpErrorMessages')]
    public function testProviderHttpErrorsBecomeActionableSafeMessages(int $status, string $message): void
    {
        $provider = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE),
            $this->stack([new Response($status, [], '{"error":"provider-secret"}')]),
        );

        try {
            $provider->chat(new AiRequest([AiMessage::user('prompt-secret')]));
            $this->fail('The provider request should have failed.');
        } catch (AIServiceException $exception) {
            $this->assertSame($message, $exception->getMessage());
            $this->assertSame($message, $provider->lastFailure());
            $this->assertStringNotContainsString('provider-secret', $exception->getMessage());
            $this->assertStringNotContainsString('prompt-secret', $exception->getMessage());
        }
    }

    public static function providerHttpErrorMessages(): array
    {
        return [
            'bad credentials' => [401, AbstractProvider::AUTHENTICATION_ERROR_MESSAGE],
            'missing endpoint or model' => [404, AbstractProvider::ENDPOINT_OR_MODEL_ERROR_MESSAGE],
            'rate limited' => [429, AbstractProvider::RATE_LIMIT_MESSAGE],
            'incompatible request' => [422, AbstractProvider::INCOMPATIBLE_REQUEST_MESSAGE],
            'provider unavailable' => [503, ProviderReadiness::UNREACHABLE_MESSAGE],
        ];
    }

    public function testMalformedProviderResponseHasCompatibilityGuidanceWithoutParserDetails(): void
    {
        $provider = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE),
            $this->stack([new Response(200, [], '{not-json')]),
        );

        try {
            $provider->chat(new AiRequest([AiMessage::user('test')]));
            $this->fail('The malformed response should have failed.');
        } catch (AIServiceException $exception) {
            $this->assertSame(AbstractProvider::INVALID_RESPONSE_MESSAGE, $exception->getMessage());
            $this->assertStringNotContainsString('Syntax error', $exception->getMessage());
        }
    }

    /**
     * `contextTokens` defaults to a concrete value so the Ollama driver does
     * not fire a capability probe while building the payload — tests that care
     * about the probe set it to null and enqueue an /api/show response.
     */
    private function config(string $provider, array $overrides = []): ProviderConfig
    {
        return new ProviderConfig(
            provider: $provider,
            endpoint: $overrides['endpoint'] ?? 'http://127.0.0.1:11434/v1',
            apiKey: $overrides['apiKey'] ?? '',
            model: $overrides['model'] ?? 'test-model',
            maxTokens: 512,
            temperature: 0.3,
            systemPrompt: 'You are a test.',
            contextTokens: array_key_exists('contextTokens', $overrides) ? $overrides['contextTokens'] : 32768,
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Ollama — native API
    |--------------------------------------------------------------------------
    */

    public function testOllamaUsesNativeChatEndpointWithRuntimeOptions(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => ['role' => 'assistant', 'content' => 'Hello from Ollama!'],
            'done' => true,
            'done_reason' => 'stop',
            'prompt_eval_count' => 12,
            'eval_count' => 5,
            'eval_duration' => 100_000_000,
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $response = $provider->chat(new AiRequest([AiMessage::user('Test prompt')]));

        $this->assertSame('Hello from Ollama!', $response->content);
        $this->assertSame(12, $response->usage['prompt_tokens']);
        $this->assertSame(5, $response->usage['completion_tokens']);
        $this->assertSame(100.0, $response->usage['generation_duration_ms']);

        // The native API is what honours num_ctx and keep_alive; the /v1 shim
        // silently discards both.
        $this->assertSame('/api/chat', $this->sentPath());

        $payload = $this->sentPayload();
        $this->assertArrayHasKey('options', $payload);
        $this->assertArrayHasKey('num_ctx', $payload['options']);
        $this->assertSame(512, $payload['options']['num_predict']);
        $this->assertFalse($payload['think']);
        $this->assertSame('10m', $payload['keep_alive']);
    }

    public function testOllamaTransportsTheRequestedReasoningMode(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => ['role' => 'assistant', 'content' => 'Done.'],
            'done' => true,
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $provider->chat((new AiRequest([AiMessage::user('Think first')], noCache: true))->withReasoning());

        $this->assertTrue($this->sentPayload()['think']);
    }

    public function testOllamaSendsToolsAndSizesContextToTheRequest(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => [
                'role' => 'assistant',
                'content' => '',
                'tool_calls' => [
                    ['function' => ['name' => 'files_read', 'arguments' => ['path' => '/server.properties']]],
                ],
            ],
            'done' => true,
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $response = $provider->chat(new AiRequest(
            messages: [AiMessage::user('read the properties file')],
            tools: [$this->tool()],
        ));

        $this->assertTrue($response->hasToolCalls());
        $this->assertSame(AiResponse::FINISH_TOOL_CALLS, $response->finishReason);
        $this->assertSame('files_read', $response->toolCalls[0]->name);
        // Ollama returns arguments already decoded, unlike the OpenAI shape.
        $this->assertSame(['path' => '/server.properties'], $response->toolCalls[0]->arguments);
        $this->assertMatchesRegularExpression('/^call_[a-f0-9]{24}_0$/', $response->toolCalls[0]->id);

        $payload = $this->sentPayload();
        $this->assertSame('files_read', $payload['tools'][0]['function']['name']);
        $this->assertGreaterThanOrEqual(OllamaProvider::MIN_CONTEXT, $payload['options']['num_ctx']);
    }

    public function testMissingIdsAreUniqueAcrossParallelCallsAndResponses(): void
    {
        $reply = fn (string $path) => new Response(200, [], json_encode([
            'message' => [
                'role' => 'assistant',
                'content' => '',
                'tool_calls' => [
                    ['function' => ['name' => 'files_read', 'arguments' => ['path' => $path . '/a']]],
                    ['function' => ['name' => 'files_read', 'arguments' => ['path' => $path . '/b']]],
                ],
            ],
            'done' => true,
        ]));

        $stack = $this->stack([$reply('/one'), $reply('/two')]);
        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $request = new AiRequest(messages: [AiMessage::user('read both')], tools: [$this->tool()]);

        $first = $provider->chat($request)->toolCalls;
        $second = $provider->chat($request)->toolCalls;
        $ids = array_map(fn (AiToolCall $call) => $call->id, [...$first, ...$second]);

        $this->assertCount(4, array_unique($ids));
        $this->assertStringEndsWith('_0', $first[0]->id);
        $this->assertStringEndsWith('_1', $first[1]->id);
        $this->assertNotSame($first[0]->id, $second[0]->id);
    }

    /**
     * AI-040. The two identity namespaces are disjoint by construction.
     *
     * Provider ids are unconstrained strings and batch children need ids the
     * panel derives, so without a reservation the two share one space — and a
     * collision merges two distinct calls into one visible row, attaching a
     * result to the wrong one. A provider claiming a derived id is treated as
     * having supplied none.
     */
    public function testAProviderCannotClaimAnIdFromTheDerivedBatchNamespace(): void
    {
        $derived = AiToolCall::derivedBatchId(str_repeat('ab', 16), 0);

        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => [
                'role' => 'assistant',
                'content' => '',
                'tool_calls' => [
                    ['id' => $derived, 'function' => ['name' => 'files_read', 'arguments' => ['path' => '/a']]],
                    ['id' => 'call_legitimate', 'function' => ['name' => 'files_read', 'arguments' => ['path' => '/b']]],
                ],
            ],
            'done' => true,
        ]))]);

        $calls = (new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack))
            ->chat(new AiRequest(messages: [AiMessage::user('read both')], tools: [$this->tool()]))
            ->toolCalls;

        $this->assertTrue(AiToolCall::isDerivedId($derived));
        $this->assertNotSame($derived, $calls[0]->id);
        $this->assertFalse(AiToolCall::isDerivedId($calls[0]->id));

        // An ordinary id is still the provider's to choose — reminting every id
        // would break the one thing the id exists for, which is answering the
        // call the model actually made.
        $this->assertSame('call_legitimate', $calls[1]->id);
    }

    public function testOllamaRepairPathSendsGrammarAndDropsTools(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => ['role' => 'assistant', 'content' => '{"name":"files_read","arguments":{}}'],
            'done' => true,
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $provider->chat(
            (new AiRequest(messages: [AiMessage::user('x')], tools: [$this->tool()]))
                ->withResponseSchema(['type' => 'object', 'properties' => new \stdClass()])
        );

        $payload = $this->sentPayload();
        // A grammar that forces one JSON shape cannot coexist with tool
        // emission, so the repair round drops tools deliberately.
        $this->assertArrayHasKey('format', $payload);
        $this->assertArrayNotHasKey('tools', $payload);
    }

    public function testOllamaSerialisesToolResultsByName(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => ['role' => 'assistant', 'content' => 'done'],
            'done' => true,
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $provider->chat(new AiRequest([
            AiMessage::user('read it'),
            AiMessage::assistant(null, [new AiToolCall('call_0', 'files_read', ['path' => '/a'])]),
            AiMessage::tool('call_0', 'files_read', 'file contents'),
        ]));

        $messages = $this->sentPayload()['messages'];
        $toolMessage = end($messages);

        // Ollama has no tool-call ids — it correlates by name, so tool_name is
        // what makes a multi-call turn resolvable.
        $this->assertSame('tool', $toolMessage['role']);
        $this->assertSame('files_read', $toolMessage['tool_name']);
        $this->assertArrayNotHasKey('tool_call_id', $toolMessage);
    }

    public function testOllamaCapabilityProbeBlocksModelsWithoutToolSupport(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'capabilities' => ['completion'],
            'model_info' => ['qwen3.context_length' => 40960],
        ]))]);

        $provider = new OllamaProvider(
            $this->config(ProviderConfig::PROVIDER_OLLAMA, ['contextTokens' => null, 'model' => 'some-base-model']),
            $stack
        );

        $capabilities = $provider->capabilities();

        // A model that cannot emit tool calls must fail closed, not silently
        // degrade into prose that looks like a plan.
        $this->assertFalse($capabilities->supportsTools);
        $this->assertNotEmpty($capabilities->warnings);
        $this->assertSame(40960, $capabilities->maxContextTokens);
        $this->assertSame('/api/show', $this->sentPath());
    }

    public function testOllamaCapabilityProbeAcceptsToolCapableModels(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'capabilities' => ['completion', 'tools', 'thinking'],
            'model_info' => [
                'llama.context_length' => 131072,
                'general.parameter_count' => 4_300_000_000,
            ],
            'details' => ['parameter_size' => '8B'],
        ]))]);

        $provider = new OllamaProvider(
            $this->config(ProviderConfig::PROVIDER_OLLAMA, ['contextTokens' => null, 'model' => 'qwen3']),
            $stack
        );

        $capabilities = $provider->capabilities();

        $this->assertTrue($capabilities->supportsTools);
        $this->assertTrue($capabilities->supportsReasoning);
        $this->assertSame([], $capabilities->warnings);
        $this->assertTrue($capabilities->selfHosted);
        $this->assertSame(4_300_000_000, $capabilities->modelParameterCount);
    }

    public function testOllamaCapabilityProbeFallsBackToTheParameterSizeLabel(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'capabilities' => ['completion', 'tools'],
            'model_info' => ['qwen3.context_length' => 32768],
            'details' => ['parameter_size' => '1.7B'],
        ]))]);

        $provider = new OllamaProvider(
            $this->config(ProviderConfig::PROVIDER_OLLAMA, ['model' => 'qwen3']),
            $stack,
        );

        $this->assertSame(1_700_000_000, $provider->capabilities()->modelParameterCount);
    }

    /*
    |--------------------------------------------------------------------------
    | OpenAI-compatible
    |--------------------------------------------------------------------------
    */

    public function testOpenAiCompatibleUsesChatCompletionsWithTools(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'choices' => [[
                'message' => [
                    'content' => null,
                    'tool_calls' => [[
                        'id' => 'call_abc',
                        'type' => 'function',
                        'function' => ['name' => 'files_read', 'arguments' => '{"path":"/eula.txt"}'],
                    ]],
                ],
                'finish_reason' => 'tool_calls',
            ]],
            'usage' => ['prompt_tokens' => 30, 'completion_tokens' => 8, 'total_tokens' => 38],
            'timings' => ['predicted_ms' => 160.0],
        ]))]);

        $provider = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI, ['endpoint' => 'https://api.openai.com/v1', 'apiKey' => 'sk-test']),
            $stack
        );

        $response = $provider->chat(new AiRequest(
            messages: [AiMessage::user('read the eula')],
            tools: [$this->tool()],
        ));

        $this->assertSame('/v1/chat/completions', $this->sentPath());
        $this->assertSame('files_read', $response->toolCalls[0]->name);
        // Arguments arrive as a JSON string here, unlike Ollama's native API.
        $this->assertSame(['path' => '/eula.txt'], $response->toolCalls[0]->arguments);
        $this->assertSame(38, $response->totalTokens());
        $this->assertSame(160.0, $response->usage['generation_duration_ms']);

        $payload = $this->sentPayload();
        $this->assertSame('function', $payload['tools'][0]['type']);
        $this->assertSame('auto', $payload['tool_choice']);
    }

    public function testOpenAiCompatibleAssemblesStreamedToolCallsByIndex(): void
    {
        // Arguments arrive fragmented and are keyed by index, not id — the id
        // appears only in the first fragment.
        $sse = implode('', array_map(
            fn (array $chunk) => 'data: ' . json_encode($chunk) . "\n\n",
            [
                ['choices' => [['delta' => ['tool_calls' => [['index' => 0, 'id' => 'call_1', 'function' => ['name' => 'files_read', 'arguments' => '']]]]]]],
                ['choices' => [['delta' => ['tool_calls' => [['index' => 0, 'function' => ['arguments' => '{"pa']]]]]]],
                ['choices' => [['delta' => ['tool_calls' => [['index' => 0, 'function' => ['arguments' => 'th":"/a.txt"}']]]]]]],
                ['choices' => [['delta' => [], 'finish_reason' => 'tool_calls']]],
            ]
        )) . "data: [DONE]\n\n";

        $stack = $this->stack([new Response(200, [], $sse)]);
        $provider = new OpenAiCompatibleProvider($this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE), $stack);

        $calls = [];
        $finish = null;
        foreach ($provider->stream(new AiRequest([AiMessage::user('x')], tools: [$this->tool()])) as $event) {
            if ($event->type === AiStreamEvent::TYPE_TOOL_CALL) {
                $calls[] = $event->toolCall;
            } elseif ($event->type === AiStreamEvent::TYPE_DONE) {
                $finish = $event->finishReason;
            }
        }

        $this->assertCount(1, $calls);
        $this->assertSame('call_1', $calls[0]->id);
        $this->assertSame(['path' => '/a.txt'], $calls[0]->arguments);
        $this->assertSame(AiResponse::FINISH_TOOL_CALLS, $finish);
    }

    public function testMissingApiKeyThrowsForHostedProviders(): void
    {
        $provider = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI, ['endpoint' => 'https://api.openai.com/v1', 'apiKey' => ''])
        );

        $this->expectException(AIServiceException::class);
        $this->expectExceptionMessage('The AI provider has no API key configured.');

        $provider->chat(new AiRequest([AiMessage::user('Test')]));
    }

    public function testOpenAiCompatibleLocalServerAcceptsABlankApiKeyWithoutSendingAuthorization(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'choices' => [[
                'message' => ['content' => 'ok'],
                'finish_reason' => 'stop',
            ]],
        ]))]);

        $provider = new OpenAiCompatibleProvider($this->config(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            ['endpoint' => 'http://127.0.0.1:8080/v1', 'apiKey' => ''],
        ), $stack);

        $response = $provider->chat(new AiRequest([AiMessage::user('x')], noCache: true));

        $this->assertSame('ok', $response->content);
        $this->assertFalse($this->history[0]['request']->hasHeader('Authorization'));
        $this->assertNotEmpty($provider->capabilities()->warnings);
        $this->assertFalse($provider->capabilities()->toolSupportVerified);
    }

    public function testOpenAiCompatibleTransportsPerRequestReasoningControl(): void
    {
        $reply = static fn (): Response => new Response(200, [], json_encode([
            'choices' => [[
                'message' => ['content' => 'ok'],
                'finish_reason' => 'stop',
            ]],
        ]));
        $stack = $this->stack([$reply(), $reply()]);
        $provider = new OpenAiCompatibleProvider($this->config(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            ['endpoint' => 'http://127.0.0.1:8080/v1'],
        ), $stack);

        $provider->chat((new AiRequest([AiMessage::user('think')], noCache: true))->withReasoning());
        $provider->chat(new AiRequest([AiMessage::user('answer directly')], noCache: true));

        $this->assertArrayNotHasKey('reasoning_effort', $this->sentPayload(0));
        $this->assertArrayNotHasKey('chat_template_kwargs', $this->sentPayload(0));
        $this->assertSame('none', $this->sentPayload(1)['reasoning_effort']);
        $this->assertSame(
            ['enable_thinking' => false],
            $this->sentPayload(1)['chat_template_kwargs'],
        );
    }

    public function testOpenAiCompatibleCanVerifyAndCacheToolCallingForTheExactModel(): void
    {
        Cache::flush();
        $stack = $this->stack([new Response(200, [], json_encode([
            'choices' => [[
                'message' => [
                    'content' => null,
                    'tool_calls' => [[
                        'id' => 'call_probe',
                        'type' => 'function',
                        'function' => ['name' => 'capability_probe', 'arguments' => '{}'],
                    ]],
                ],
                'finish_reason' => 'tool_calls',
            ]],
        ]))]);

        $provider = new OpenAiCompatibleProvider($this->config(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            ['endpoint' => 'http://127.0.0.1:8080/v1', 'model' => 'tool-model'],
        ), $stack);

        $result = $provider->probeToolCalling();

        $this->assertSame('supported', $result['status']);
        $this->assertTrue($result['supports_tools']);
        $this->assertSame('tool-model', $result['model']);

        $payload = $this->sentPayload();
        $this->assertSame('/v1/chat/completions', $this->sentPath());
        $this->assertSame('capability_probe', $payload['tools'][0]['function']['name']);
        $this->assertSame(AiRequest::TOOL_CHOICE_AUTO, $payload['tool_choice']);
        $this->assertSame(256, $payload['max_tokens']);
        $this->assertSame(0, $payload['temperature']);
        $this->assertFalse($payload['stream']);

        // Reading capabilities uses the cached result and makes no second
        // inference request. A different model remains unverified.
        $capabilities = $provider->capabilities();
        $this->assertTrue($capabilities->supportsTools);
        $this->assertTrue($capabilities->toolSupportVerified);
        $this->assertSame([], $capabilities->warnings);
        $this->assertCount(1, $this->history);

        $otherModel = $provider->capabilities('another-model');
        $this->assertTrue($otherModel->supportsTools);
        $this->assertFalse($otherModel->toolSupportVerified);
        $this->assertNotEmpty($otherModel->warnings);
    }

    public function testOpenAiCompatibleFailedToolCallProbeBlocksThatModel(): void
    {
        Cache::flush();
        $stack = $this->stack([new Response(200, [], json_encode([
            'choices' => [[
                'message' => ['content' => 'I cannot call tools.'],
                'finish_reason' => 'stop',
            ]],
        ]))]);

        $provider = new OpenAiCompatibleProvider($this->config(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            ['endpoint' => 'http://127.0.0.1:8080/v1', 'model' => 'text-only-model'],
        ), $stack);

        $result = $provider->probeToolCalling();
        $capabilities = $provider->capabilities();

        $this->assertSame('unsupported', $result['status']);
        $this->assertFalse($result['supports_tools']);
        $this->assertFalse($capabilities->supportsTools);
        $this->assertTrue($capabilities->toolSupportVerified);
        $this->assertStringContainsString('text-only-model', $capabilities->warnings[0]);
        $this->assertCount(1, $this->history);
    }

    public function testToolCallingProbeRejectsTheOfficialOpenAiProvider(): void
    {
        $provider = new OpenAiCompatibleProvider($this->config(
            ProviderConfig::PROVIDER_OPENAI,
            ['endpoint' => 'https://api.openai.com/v1', 'apiKey' => 'sk-test'],
        ));

        $this->expectException(AIServiceException::class);
        $this->expectExceptionMessage('only available for generic OpenAI-compatible providers');

        $provider->probeToolCalling();
    }

    public function testSelfHostedProvidersDoNotRequireAnApiKey(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'message' => ['content' => 'ok'], 'done' => true,
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA, ['apiKey' => '']), $stack);

        $this->assertSame('ok', $provider->chat(new AiRequest([AiMessage::user('x')]))->content);
    }

    /*
    |--------------------------------------------------------------------------
    | Anthropic
    |--------------------------------------------------------------------------
    */

    public function testAnthropicMergesConsecutiveToolResultsIntoOneUserMessage(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'content' => [['type' => 'text', 'text' => 'Both read.']],
            'stop_reason' => 'end_turn',
            'usage' => ['input_tokens' => 40, 'output_tokens' => 6],
        ]))]);

        $provider = new AnthropicProvider(
            $this->config(ProviderConfig::PROVIDER_ANTHROPIC, ['endpoint' => 'https://api.anthropic.com/v1', 'apiKey' => 'sk-ant-test']),
            $stack
        );

        $provider->chat(new AiRequest([
            AiMessage::user('read both'),
            AiMessage::assistant(null, [
                new AiToolCall('tu_1', 'files_read', ['path' => '/a']),
                new AiToolCall('tu_2', 'files_read', ['path' => '/b']),
            ]),
            AiMessage::tool('tu_1', 'files_read', 'contents of a'),
            AiMessage::tool('tu_2', 'files_read', 'contents of b'),
        ]));

        $payload = $this->sentPayload();

        // Splitting results across messages trains the model out of parallel
        // tool calls, so both must land in a single user turn.
        $this->assertCount(3, $payload['messages']);
        $last = $payload['messages'][2];
        $this->assertSame('user', $last['role']);
        $this->assertCount(2, $last['content']);
        $this->assertSame('tool_result', $last['content'][0]['type']);
        $this->assertSame('tu_2', $last['content'][1]['tool_use_id']);

        // The system prompt is a top-level field, never a message.
        $this->assertSame('You are a test.', $payload['system']);
        $this->assertSame('user', $payload['messages'][0]['role']);
    }

    public function testAnthropicRequestsAutomaticPromptCaching(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'content' => [['type' => 'text', 'text' => 'ok']],
            'stop_reason' => 'end_turn',
        ]))]);

        (new AnthropicProvider(
            $this->config(ProviderConfig::PROVIDER_ANTHROPIC, ['endpoint' => 'https://api.anthropic.com/v1', 'apiKey' => 'sk-ant-test']),
            $stack
        ))->chat(new AiRequest([AiMessage::user('hi')]));

        // A single top-level breakpoint: the API walks it forward to the end of
        // the cacheable prefix as the transcript grows, which is exactly the
        // shape an agent turn re-sending its whole history needs.
        $this->assertSame(['type' => 'ephemeral'], $this->sentPayload()['cache_control'] ?? null);
    }

    /**
     * `input_tokens` counts only what fell outside the cache breakpoint, so
     * reading it alone under-reports a cached turn by most of its prompt — and
     * token budgets would quietly stop binding once caching started working.
     */
    public function testAnthropicCountsCachedTokensTowardsPromptUsage(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'content' => [['type' => 'text', 'text' => 'ok']],
            'stop_reason' => 'end_turn',
            'usage' => [
                'input_tokens' => 50,
                'cache_creation_input_tokens' => 500,
                'cache_read_input_tokens' => 2000,
                'output_tokens' => 10,
            ],
        ]))]);

        $response = (new AnthropicProvider(
            $this->config(ProviderConfig::PROVIDER_ANTHROPIC, ['endpoint' => 'https://api.anthropic.com/v1', 'apiKey' => 'sk-ant-test']),
            $stack
        ))->chat(new AiRequest([AiMessage::user('hi')]));

        $this->assertSame(2550, $response->usage['prompt_tokens']);
        $this->assertSame(2560, $response->usage['total_tokens']);
        $this->assertSame(2000, $response->usage['cache_read_tokens']);
        $this->assertSame(500, $response->usage['cache_write_tokens']);
    }

    public function testAnthropicOmitsSamplingParamsOnModelsThatRejectThem(): void
    {
        $stack = $this->stack([
            new Response(200, [], json_encode(['content' => [], 'stop_reason' => 'end_turn'])),
            new Response(200, [], json_encode(['content' => [], 'stop_reason' => 'end_turn'])),
        ]);

        $config = $this->config(ProviderConfig::PROVIDER_ANTHROPIC, [
            'endpoint' => 'https://api.anthropic.com/v1',
            'apiKey' => 'sk-ant-test',
            'model' => 'claude-opus-5',
        ]);
        $provider = new AnthropicProvider($config, $stack);

        // Current models 400 on temperature — the agent pins it to 0 during
        // tool selection, so passing it through would hard-fail every turn.
        $provider->chat(new AiRequest([AiMessage::user('x')], temperature: 0.0));
        $this->assertArrayNotHasKey('temperature', $this->sentPayload(0));

        $legacy = new AnthropicProvider($config->withModel('claude-haiku-4-5'), $stack);
        $legacy->chat(new AiRequest([AiMessage::user('x')], temperature: 0.0));
        $this->assertArrayHasKey('temperature', $this->sentPayload(1));
    }

    public function testAnthropicAssemblesStreamedToolUseBlocks(): void
    {
        $frames = [
            ['event' => 'message_start', 'data' => ['type' => 'message_start', 'message' => ['usage' => ['input_tokens' => 25]]]],
            ['event' => 'content_block_start', 'data' => ['type' => 'content_block_start', 'index' => 0, 'content_block' => ['type' => 'tool_use', 'id' => 'tu_9', 'name' => 'files_read', 'input' => []]]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'input_json_delta', 'partial_json' => '{"path"']]],
            ['event' => 'content_block_delta', 'data' => ['type' => 'content_block_delta', 'index' => 0, 'delta' => ['type' => 'input_json_delta', 'partial_json' => ':"/b.txt"}']]],
            ['event' => 'content_block_stop', 'data' => ['type' => 'content_block_stop', 'index' => 0]],
            ['event' => 'message_delta', 'data' => ['type' => 'message_delta', 'delta' => ['stop_reason' => 'tool_use'], 'usage' => ['output_tokens' => 17]]],
        ];

        $sse = '';
        foreach ($frames as $frame) {
            $sse .= 'event: ' . $frame['event'] . "\n" . 'data: ' . json_encode($frame['data']) . "\n\n";
        }

        $stack = $this->stack([new Response(200, [], $sse)]);
        $provider = new AnthropicProvider(
            $this->config(ProviderConfig::PROVIDER_ANTHROPIC, ['endpoint' => 'https://api.anthropic.com/v1', 'apiKey' => 'sk-ant-test']),
            $stack
        );

        $calls = [];
        $usage = [];
        foreach ($provider->stream(new AiRequest([AiMessage::user('x')], tools: [$this->tool()])) as $event) {
            if ($event->type === AiStreamEvent::TYPE_TOOL_CALL) {
                $calls[] = $event->toolCall;
            } elseif ($event->type === AiStreamEvent::TYPE_USAGE) {
                $usage = $event->usage;
            }
        }

        $this->assertCount(1, $calls);
        $this->assertSame(['path' => '/b.txt'], $calls[0]->arguments);
        $this->assertSame(25, $usage['prompt_tokens']);
        $this->assertSame(17, $usage['completion_tokens']);
    }

    public function testAnthropicSurfacesRefusalsDistinctlyFromErrors(): void
    {
        $stack = $this->stack([new Response(200, [], json_encode([
            'content' => [],
            'stop_reason' => 'refusal',
            'stop_details' => ['type' => 'refusal', 'category' => 'cyber'],
        ]))]);

        $provider = new AnthropicProvider(
            $this->config(ProviderConfig::PROVIDER_ANTHROPIC, ['endpoint' => 'https://api.anthropic.com/v1', 'apiKey' => 'sk-ant-test']),
            $stack
        );

        $response = $provider->chat(new AiRequest([AiMessage::user('x')]));

        // A refusal is a successful call with no usable content — retrying the
        // same prompt will not help, so it must not read as a transport error.
        $this->assertSame(AiResponse::FINISH_REFUSAL, $response->finishReason);
        $this->assertStringContainsString('cyber', (string) $response->content);
    }

    /*
    |--------------------------------------------------------------------------
    | Caching
    |--------------------------------------------------------------------------
    */

    public function testRequestsCarryingToolsAreNeverCached(): void
    {
        $stack = $this->stack([
            new Response(200, [], json_encode(['message' => ['content' => 'first'], 'done' => true])),
            new Response(200, [], json_encode(['message' => ['content' => 'second'], 'done' => true])),
        ]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $request = new AiRequest([AiMessage::user('same prompt')], tools: [$this->tool()]);

        // A cached turn would replay a stale plan built against a filesystem
        // that has since changed.
        $this->assertSame('first', $provider->chat($request)->content);
        $this->assertSame('second', $provider->chat($request)->content);
        $this->assertCount(2, $this->history);
    }

    public function testResponseCacheDoesNotCrossEndpointsOrCredentials(): void
    {
        Cache::flush();
        $request = new AiRequest([AiMessage::user('same prompt')]);

        $first = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE, [
                'endpoint' => 'http://first.local/v1',
                'apiKey' => 'first-secret',
            ]),
            $this->stack([new Response(200, [], json_encode([
                'choices' => [['message' => ['content' => 'first'], 'finish_reason' => 'stop']],
            ]))]),
        );
        $this->assertSame('first', $first->chat($request)->content);

        $second = new OpenAiCompatibleProvider(
            $this->config(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE, [
                'endpoint' => 'http://second.local/v1',
                'apiKey' => 'second-secret',
            ]),
            $this->stack([new Response(200, [], json_encode([
                'choices' => [['message' => ['content' => 'second'], 'finish_reason' => 'stop']],
            ]))]),
        );

        $this->assertSame('second', $second->chat($request)->content);
        $this->assertCount(1, $this->history);
    }
}
