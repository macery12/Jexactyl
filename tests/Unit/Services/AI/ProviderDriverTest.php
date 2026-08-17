<?php

namespace Everest\Tests\Unit\Services\AI;

use GuzzleHttp\Middleware;
use Everest\Tests\TestCase;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Handler\MockHandler;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Providers\OllamaProvider;
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
        ]))]);

        $provider = new OllamaProvider($this->config(ProviderConfig::PROVIDER_OLLAMA), $stack);
        $response = $provider->chat(new AiRequest([AiMessage::user('Test prompt')]));

        $this->assertSame('Hello from Ollama!', $response->content);
        $this->assertSame(12, $response->usage['prompt_tokens']);
        $this->assertSame(5, $response->usage['completion_tokens']);

        // The native API is what honours num_ctx and keep_alive; the /v1 shim
        // silently discards both.
        $this->assertSame('/api/chat', $this->sentPath());

        $payload = $this->sentPayload();
        $this->assertArrayHasKey('options', $payload);
        $this->assertArrayHasKey('num_ctx', $payload['options']);
        $this->assertSame(512, $payload['options']['num_predict']);
        $this->assertSame('10m', $payload['keep_alive']);
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
            'model_info' => ['llama.context_length' => 131072],
        ]))]);

        $provider = new OllamaProvider(
            $this->config(ProviderConfig::PROVIDER_OLLAMA, ['contextTokens' => null, 'model' => 'qwen3']),
            $stack
        );

        $capabilities = $provider->capabilities();

        $this->assertTrue($capabilities->supportsTools);
        $this->assertSame([], $capabilities->warnings);
        $this->assertTrue($capabilities->selfHosted);
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
        $this->expectExceptionMessage('AI API key is not configured.');

        $provider->chat(new AiRequest([AiMessage::user('Test')]));
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
}
