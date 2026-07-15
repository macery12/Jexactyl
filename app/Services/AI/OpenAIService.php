<?php

namespace Everest\Services\AI;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\RequestException;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Models\Setting;

class OpenAIService
{
    /**
     * How long completed responses are cached for. Identical prompts within this
     * window are served from cache instead of re-generating (a large win for
     * repeated crash analysis of the same log on self-hosted Ollama).
     */
    public const RESPONSE_CACHE_TTL = 3600;

    private Client $client;
    private string $apiKey;
    private string $endpoint;
    private string $model;
    private string $mode;
    private string $systemPrompt;
    private float $temperature;
    private string $keepAlive;

    /**
     * Token/latency data from the last non-streamed query().
     * Shape: ['model' => string, 'prompt_tokens' => int|null, 'completion_tokens' => int|null, 'total_tokens' => int|null]
     */
    private array $lastUsage = [];

    /**
     * Whether the last query()/queryStream() was served from the response cache.
     */
    private bool $lastResponseCached = false;

    public function getLastUsage(): array
    {
        return $this->lastUsage;
    }

    public function wasCached(): bool
    {
        return $this->lastResponseCached;
    }

    /**
     * OpenAIService constructor.
     */
    public function __construct()
    {
        // All settings must be read from the database (via Setting::get) so that values
        // saved through the admin UI are actually used. Config/env values serve as fallbacks
        // only — they are NOT updated when settings are changed via the panel.
        $this->apiKey = Setting::get('settings::modules:ai:key', config('modules.ai.key')) ?: '';
        $this->endpoint = Setting::get('settings::modules:ai:endpoint', config('modules.ai.endpoint', 'https://api.openai.com/v1')) ?: 'https://api.openai.com/v1';
        $this->model = Setting::get('settings::modules:ai:model', config('modules.ai.model', 'gpt-4.1-mini')) ?: 'gpt-4.1-mini';
        $this->mode = Setting::get('settings::modules:ai:mode', config('modules.ai.mode', 'openai')) ?: 'openai';
        $this->systemPrompt = Setting::get('settings::modules:ai:system_prompt', config('modules.ai.system_prompt'))
            ?: 'You are an expert game server technician specializing in crash analysis and debugging. When given server logs, identify the root cause concisely and list specific actionable steps to resolve it. Format responses as: Cause: [what went wrong]. Fix: [numbered steps]. For general questions, give direct technical answers. Be concise.';
        $this->temperature = (float) (Setting::get('settings::modules:ai:temperature', config('modules.ai.temperature', 0.3)) ?? 0.3);
        // keep_alive controls how long Ollama keeps the model loaded after a request.
        // '-1' means "never unload" — eliminates cold starts entirely at the cost of VRAM.
        $this->keepAlive = (string) (Setting::get('settings::modules:ai:keep_alive', config('modules.ai.keep_alive', '10m')) ?: '10m');

        $this->client = new Client([
            'base_uri' => rtrim($this->endpoint, '/') . '/',
            'timeout' => 120,
        ]);
    }

    /**
     * Build a cache key for a response. Includes every knob that changes the output,
     * so saving new settings naturally invalidates old entries.
     */
    private function responseCacheKey(array $messages, string $systemPrompt, int $maxTokens, ?string $model = null): string
    {
        return 'ai:response:' . sha1(json_encode([
            $this->mode,
            $model ?? $this->model,
            $systemPrompt,
            $this->temperature,
            $maxTokens,
            $messages,
        ]));
    }

    /**
     * Send a query to the OpenAI-compatible endpoint and get a response.
     *
     * @throws AIServiceException
     */
    public function query(string $prompt, array $options = []): string
    {
        // Only require API key for OpenAI mode, not for Ollama
        if ($this->mode !== 'ollama' && empty($this->apiKey)) {
            throw new AIServiceException('AI API key is not configured.');
        }

        $this->lastResponseCached = false;
        $systemPromptForKey = $options['system_prompt'] ?? $this->systemPrompt;
        $maxTokensForKey = (int) ($options['max_tokens'] ?? Setting::get('settings::modules:ai:max_tokens', config('modules.ai.max_tokens', 500)));
        $cacheKey = $this->responseCacheKey(
            [['role' => 'user', 'content' => $prompt]],
            $systemPromptForKey,
            $maxTokensForKey,
            $options['model'] ?? null
        );

        if (empty($options['no_cache'])) {
            $cached = Cache::get($cacheKey);
            if (is_string($cached) && $cached !== '') {
                $this->lastResponseCached = true;
                $this->lastUsage = ['model' => $options['model'] ?? $this->model, 'prompt_tokens' => null, 'completion_tokens' => null, 'total_tokens' => null];

                return $cached;
            }
        }

        try {
            $headers = [
                'Content-Type' => 'application/json',
            ];

            // Only add Authorization header if API key is provided (OpenAI mode)
            if (!empty($this->apiKey)) {
                $headers['Authorization'] = 'Bearer ' . $this->apiKey;
            }

            // Build request payload based on mode
            if ($this->mode === 'openai') {
                // OpenAI new API format
                $payload = [
                    'model' => $options['model'] ?? $this->model,
                    'input' => [
                        [
                            'role' => 'system',
                            'content' => [
                                ['type' => 'input_text', 'text' => $options['system_prompt'] ?? $this->systemPrompt],
                            ],
                        ],
                        [
                            'role' => 'user',
                            'content' => [
                                ['type' => 'input_text', 'text' => $prompt],
                            ],
                        ],
                    ],
                    'max_output_tokens' => $options['max_tokens'] ?? (int) config('modules.ai.max_tokens', 200),
                ];
            } else {
                // Ollama / OpenAI-compatible format
                // Lower temperature (0.3) gives more deterministic, factual debugging answers.
                // num_ctx sets the context window so large logs are not silently truncated.
                $payload = [
                    'model' => $options['model'] ?? $this->model,
                    'messages' => [
                        [
                            'role' => 'system',
                            'content' => $options['system_prompt'] ?? $this->systemPrompt,
                        ],
                        [
                            'role' => 'user',
                            'content' => $prompt,
                        ],
                    ],
                    'max_tokens' => $options['max_tokens'] ?? (int) Setting::get('settings::modules:ai:max_tokens', config('modules.ai.max_tokens', 500)),
                    'temperature' => $options['temperature'] ?? $this->temperature,
                    'stream' => $options['stream'] ?? false,
                    'options' => [
                        'num_ctx' => 4096,
                    ],
                    'keep_alive' => $this->keepAlive,
                ];
            }

            $endpoint = $this->mode === 'openai' ? 'responses' : 'chat/completions';

            $response = $this->client->post($endpoint, [
                'headers' => $headers,
                'json' => $payload,
            ]);

            $responseBody = $response->getBody()->getContents();
            $data = json_decode($responseBody, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                Log::error('AI Service JSON decode error: ' . json_last_error_msg());
                throw new AIServiceException('Failed to decode AI service response: ' . json_last_error_msg());
            }

            if ($this->mode === 'openai') {
                // OpenAI new API response format
                if (isset($data['output_text'])) {
                    $this->lastUsage = [
                        'model' => $options['model'] ?? $this->model,
                        'prompt_tokens' => $data['usage']['input_tokens'] ?? null,
                        'completion_tokens' => $data['usage']['output_tokens'] ?? null,
                        'total_tokens' => $data['usage']['total_tokens'] ?? null,
                    ];
                    $result = trim($data['output_text']);
                    if (empty($options['no_cache']) && $result !== '') {
                        Cache::put($cacheKey, $result, self::RESPONSE_CACHE_TTL);
                    }
                    return $result;
                }
            } else {
                // Ollama / chat-completions response format
                if (isset($data['choices'][0]['message']['content'])) {
                    $this->lastUsage = [
                        'model' => $options['model'] ?? $this->model,
                        'prompt_tokens' => $data['usage']['prompt_tokens'] ?? null,
                        'completion_tokens' => $data['usage']['completion_tokens'] ?? null,
                        'total_tokens' => $data['usage']['total_tokens'] ?? null,
                    ];
                    $result = trim($data['choices'][0]['message']['content']);
                    if (empty($options['no_cache']) && $result !== '') {
                        Cache::put($cacheKey, $result, self::RESPONSE_CACHE_TTL);
                    }
                    return $result;
                }
            }

            if (isset($data['error'])) {
                $errorMsg = $data['error']['message'] ?? 'Unknown error';
                Log::error('AI Service returned error: ' . $errorMsg);
                throw new AIServiceException('AI service error: ' . $errorMsg);
            }

            throw new AIServiceException('Invalid response format from AI service.');
        } catch (GuzzleException $e) {
            Log::error('OpenAI Service Error: ' . $e->getMessage());
            if ($e instanceof RequestException && $e->hasResponse()) {
                Log::error('OpenAI Response Body: ' . (string) $e->getResponse()->getBody());
            }
            throw new AIServiceException('Failed to communicate with AI service: ' . $e->getMessage());
        }
    }

    /**
     * The endpoint root without the OpenAI-compatible /v1 suffix — Ollama's
     * native API (tags, generate) lives there.
     */
    private function endpointRoot(): string
    {
        return preg_replace('~/v1/?$~', '', rtrim($this->endpoint, '/'));
    }

    /**
     * Test the connection to the AI endpoint.
     *
     * Uses the models listing endpoint instead of a real generation: it responds
     * instantly, costs nothing, and does not trigger a cold model load on Ollama.
     */
    public function testConnection(): bool
    {
        try {
            $headers = ['Content-Type' => 'application/json'];
            if (!empty($this->apiKey)) {
                $headers['Authorization'] = 'Bearer ' . $this->apiKey;
            }

            $response = $this->client->get('models', ['headers' => $headers, 'timeout' => 10]);
            $data = json_decode($response->getBody()->getContents(), true);

            return is_array($data) && (isset($data['data']) || isset($data['models']));
        } catch (GuzzleException $e) {
            Log::warning('AI Service connection test failed: ' . $e->getMessage());

            return false;
        }
    }

    /**
     * List the models available on the configured endpoint.
     *
     * For Ollama we prefer the native /api/tags endpoint (it includes sizes);
     * both providers fall back to the OpenAI-compatible /v1/models listing.
     *
     * @return array<int, array{id: string, size: int|null}>
     *
     * @throws AIServiceException
     */
    public function listModels(): array
    {
        try {
            if ($this->mode === 'ollama') {
                try {
                    $response = $this->client->get($this->endpointRoot() . '/api/tags', ['timeout' => 10]);
                    $data = json_decode($response->getBody()->getContents(), true);
                    if (isset($data['models']) && is_array($data['models'])) {
                        return array_values(array_map(fn ($m) => [
                            'id' => $m['name'] ?? $m['model'] ?? 'unknown',
                            'size' => $m['size'] ?? null,
                        ], $data['models']));
                    }
                } catch (GuzzleException $e) {
                    // Fall through to the OpenAI-compatible listing below.
                }
            }

            $headers = ['Content-Type' => 'application/json'];
            if (!empty($this->apiKey)) {
                $headers['Authorization'] = 'Bearer ' . $this->apiKey;
            }

            $response = $this->client->get('models', ['headers' => $headers, 'timeout' => 10]);
            $data = json_decode($response->getBody()->getContents(), true);

            return array_values(array_map(
                fn ($m) => ['id' => $m['id'] ?? 'unknown', 'size' => null],
                $data['data'] ?? []
            ));
        } catch (GuzzleException $e) {
            Log::warning('AI Service model listing failed: ' . $e->getMessage());
            throw new AIServiceException('Failed to list models: ' . $e->getMessage());
        }
    }

    /**
     * Warm the configured Ollama model by asking the native API to load it
     * without generating anything (an empty /api/generate call loads the model
     * into memory and re-asserts keep_alive). No-op for non-Ollama providers.
     */
    public function warm(): bool
    {
        if ($this->mode !== 'ollama') {
            return false;
        }

        try {
            $this->client->post($this->endpointRoot() . '/api/generate', [
                'json' => [
                    'model' => $this->model,
                    'keep_alive' => $this->keepAlive,
                ],
                'timeout' => 120,
            ]);

            return true;
        } catch (GuzzleException $e) {
            Log::warning('AI model warm-up failed: ' . $e->getMessage());

            return false;
        }
    }

    /**
     * Stream a query to the OpenAI-compatible endpoint and yield chunks.
     *
     * $options['messages'] — optional pre-built array of {role, content} objects for multi-turn context.
     * When provided, $prompt is ignored and the messages array is sent directly (with the system prompt prepended).
     *
     * @throws AIServiceException
     */
    public function queryStream(string $prompt, array $options = []): \Generator
    {
        // Only require API key for OpenAI mode, not for Ollama
        if ($this->mode !== 'ollama' && empty($this->apiKey)) {
            throw new AIServiceException('AI API key is not configured.');
        }

        $systemPrompt = $options['system_prompt'] ?? $this->systemPrompt;

        // Build the messages array — either from multi-turn history or a single prompt
        $conversationMessages = $options['messages'] ?? null;
        if (!is_array($conversationMessages) || count($conversationMessages) === 0) {
            $conversationMessages = [['role' => 'user', 'content' => $prompt]];
        }

        $this->lastResponseCached = false;
        $maxTokensForKey = (int) ($options['max_tokens'] ?? Setting::get('settings::modules:ai:max_tokens', config('modules.ai.max_tokens', 500)));
        $cacheKey = $this->responseCacheKey($conversationMessages, $systemPrompt, $maxTokensForKey, $options['model'] ?? null);

        if (empty($options['no_cache'])) {
            $cached = Cache::get($cacheKey);
            if (is_string($cached) && $cached !== '') {
                $this->lastResponseCached = true;
                // Replay in word-sized chunks so the frontend still renders a stream.
                foreach (str_split($cached, 48) as $piece) {
                    yield $piece;
                }

                return;
            }
        }

        try {
            $headers = [
                'Content-Type' => 'application/json',
                'Accept' => 'text/event-stream',
            ];

            // Only add Authorization header if API key is provided (OpenAI mode)
            if (!empty($this->apiKey)) {
                $headers['Authorization'] = 'Bearer ' . $this->apiKey;
            }

            // Build request payload based on mode
            if ($this->mode === 'openai') {
                // OpenAI new API format — prepend system as first message in input array
                $inputMessages = array_merge(
                    [[
                        'role' => 'system',
                        'content' => [['type' => 'input_text', 'text' => $systemPrompt]],
                    ]],
                    array_map(fn ($m) => [
                        'role' => $m['role'],
                        'content' => [['type' => 'input_text', 'text' => $m['content']]],
                    ], $conversationMessages)
                );

                $payload = [
                    'model' => $options['model'] ?? $this->model,
                    'input' => $inputMessages,
                    'max_output_tokens' => $options['max_tokens'] ?? (int) Setting::get('settings::modules:ai:max_tokens', config('modules.ai.max_tokens', 500)),
                ];
            } else {
                // Ollama / OpenAI-compatible format — prepend system message
                $maxTokens = $options['max_tokens'] ?? (int) Setting::get('settings::modules:ai:max_tokens', config('modules.ai.max_tokens', 500));
                $payload = [
                    'model' => $options['model'] ?? $this->model,
                    'messages' => array_merge(
                        [['role' => 'system', 'content' => $systemPrompt]],
                        $conversationMessages
                    ),
                    'max_tokens' => $maxTokens,
                    'temperature' => $options['temperature'] ?? $this->temperature,
                    'stream' => true,
                    'options' => [
                        // num_ctx: context window. 2048 is enough for our compact prompts
                        // (~500 input tokens + up to 500 output). Smaller = faster model load
                        // and scheduling on Ollama; 4096 only needed for multi-turn history.
                        'num_ctx' => count($conversationMessages) > 2 ? 4096 : 2048,
                        // num_predict: tell Ollama exactly how many tokens to generate.
                        // Without this Ollama may use -1 (unlimited) or a model default,
                        // leading to runaway generation and inflated latency.
                        'num_predict' => $maxTokens,
                    ],
                    'keep_alive' => $this->keepAlive,
                ];
            }

            $endpoint = $this->mode === 'openai' ? 'responses' : 'chat/completions';

            // Ollama is single-threaded — serialise concurrent requests with a cache lock
            // to prevent garbled output when multiple users query simultaneously.
            // We wrap only the actual HTTP call, not the streaming read, so the lock is
            // released once the request is established and streaming begins.
            $lock = $this->mode === 'ollama'
                ? Cache::lock('ai_ollama_stream_lock', 90)
                : null;

            if ($lock && !$lock->block(30)) {
                throw new AIServiceException('AI is currently busy. Please try again in a moment.');
            }

            try {
                // 'stream' => true tells Guzzle to NOT buffer the response body.
                // Without this, Guzzle waits for the full Ollama reply before returning,
                // causing the frontend to spin until the model finishes generating.
                $response = $this->client->post($endpoint, [
                    'stream' => true,
                    'headers' => $headers,
                    'json' => $payload,
                ]);
            } finally {
                // Release the lock immediately once the HTTP connection is established —
                // the streaming read happens outside the lock so others aren't blocked during output.
                $lock?->release();
            }

            $body = $response->getBody();
            $buffer = '';
            $currentEvent = null;
            $fullResponse = '';

            while (!$body->eof()) {
                $chunk = $body->read(1024);
                $buffer .= $chunk;

                // Process complete lines
                while (($pos = strpos($buffer, "\n")) !== false) {
                    $line = substr($buffer, 0, $pos);
                    $buffer = substr($buffer, $pos + 1);

                    $line = trim($line);
                    if (empty($line) || $line === 'data: [DONE]') {
                        continue;
                    }

                    // Track event type for OpenAI's new streaming format
                    if (str_starts_with($line, 'event: ')) {
                        $currentEvent = substr($line, 7);
                        continue;
                    }

                    if (str_starts_with($line, 'data: ')) {
                        $jsonData = substr($line, 6);
                        $data = json_decode($jsonData, true);

                        if (json_last_error() === JSON_ERROR_NONE) {
                            if ($this->mode === 'openai') {
                                // OpenAI new API: streaming sends event-based chunks with 'text' field
                                if ($currentEvent === 'response.output_text.delta' && isset($data['text'])) {
                                    $fullResponse .= $data['text'];
                                    yield $data['text'];
                                }
                            } else {
                                // Ollama: use existing format
                                if (isset($data['choices'][0]['delta']['content'])) {
                                    $fullResponse .= $data['choices'][0]['delta']['content'];
                                    yield $data['choices'][0]['delta']['content'];
                                }
                            }
                        }

                        $currentEvent = null; // Reset event after processing data
                    }
                }
            }

            if (empty($options['no_cache']) && trim($fullResponse) !== '') {
                Cache::put($cacheKey, trim($fullResponse), self::RESPONSE_CACHE_TTL);
            }
        } catch (GuzzleException $e) {
            Log::error('OpenAI Service Streaming Error: ' . $e->getMessage());
            if ($e instanceof RequestException && $e->hasResponse()) {
                Log::error('OpenAI Streaming Response Body: ' . (string) $e->getResponse()->getBody());
            }
            throw new AIServiceException('Failed to communicate with AI service: ' . $e->getMessage());
        }
    }
}
