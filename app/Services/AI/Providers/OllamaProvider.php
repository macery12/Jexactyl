<?php

namespace Everest\Services\AI\Providers;

use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Data\AiTool;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Support\TokenEstimator;
use Everest\Services\AI\Data\ProviderCapabilities;
use Everest\Exceptions\Service\AI\AIServiceException;

/**
 * Ollama driver, speaking the **native** `/api/chat` API rather than the
 * OpenAI-compatible `/v1` shim.
 *
 * The compatibility layer builds a fixed request struct and silently discards
 * fields it does not recognise, so `options.num_ctx`, `keep_alive`, and
 * `format` have no effect there. All three matter here: `num_ctx` because tool
 * results are large and a default 2k window truncates them, `keep_alive`
 * because cold loads dominate latency, and `format` because a JSON-schema
 * grammar is the mechanism that makes a small local model produce a valid tool
 * call after it has produced a malformed one.
 */
class OllamaProvider extends AbstractProvider
{
    /**
     * Floor for the context window. Anything smaller cannot hold a system
     * prompt plus a directory listing plus a config file.
     */
    public const MIN_CONTEXT = 4096;

    /**
     * Ceiling applied when the model does not report its own context length.
     * Oversizing num_ctx costs VRAM proportionally, so we do not guess high.
     */
    public const DEFAULT_MAX_CONTEXT = 32768;

    /**
     * Headroom added to the estimated prompt size before rounding up, covering
     * estimator error and the tool results still to come in this turn.
     */
    public const CONTEXT_HEADROOM = 2048;

    /**
     * Memoised result of contextCeiling().
     */
    private ?int $contextCeiling = null;

    public function chat(AiRequest $request): AiResponse
    {
        $this->beginToolCallResponse();
        $this->assertConfigured();

        if (($cached = $this->cachedText($request)) !== null) {
            return new AiResponse($cached, model: $this->resolveModel($request), cached: true);
        }

        $data = $this->postJson($this->nativePath('chat'), $this->buildPayload($request, false));
        $message = $data['message'] ?? [];

        $content = isset($message['content']) ? trim((string) $message['content']) : null;
        $toolCalls = $this->parseToolCalls($message['tool_calls'] ?? []);

        if ($content !== null && $toolCalls === []) {
            $this->storeText($request, $content);
        }

        return new AiResponse(
            $content,
            $toolCalls,
            $this->mapFinishReason($data['done_reason'] ?? null, $toolCalls),
            $this->extractUsage($data),
            $data['model'] ?? $this->resolveModel($request),
        );
    }

    public function stream(AiRequest $request): \Generator
    {
        $this->beginToolCallResponse();
        $this->assertConfigured();

        if (($cached = $this->cachedText($request)) !== null) {
            yield from $this->replayCached($cached);

            return;
        }

        $body = $this->postStream($this->nativePath('chat'), $this->buildPayload($request, true));

        $text = '';
        $usage = [];
        $finish = null;
        $collected = [];
        $announced = 0;
        $inThink = false;

        foreach ($this->readNdjson($body) as $frame) {
            if (isset($frame['error'])) {
                throw new AIServiceException(self::PROVIDER_REJECTED_MESSAGE);
            }

            $message = $frame['message'] ?? [];

            // Ollama splits reasoning off into its own field for models whose
            // template it knows. Nothing has to be echoed back — unlike
            // Anthropic, the API keeps no signature over it.
            $thought = $message['thinking'] ?? null;
            if (is_string($thought) && $thought !== '') {
                yield AiStreamEvent::reasoning($thought);
            }

            $delta = $message['content'] ?? null;
            if (is_string($delta) && $delta !== '') {
                // For a model whose template Ollama does not know, the same
                // reasoning arrives inline as <think> tags instead. Left alone
                // it renders as the answer.
                foreach ($this->splitReasoning($delta, $inThink) as [$channel, $piece]) {
                    if ($channel === 'reasoning') {
                        yield AiStreamEvent::reasoning($piece);

                        continue;
                    }

                    $text .= $piece;

                    yield AiStreamEvent::text($piece);
                }
            }

            // Unlike the OpenAI wire format, Ollama emits each tool call whole
            // rather than streaming its arguments — no per-index accumulation.
            foreach ($this->parseToolCalls($message['tool_calls'] ?? [], count($collected)) as $call) {
                $collected[] = $call;

                yield AiStreamEvent::toolCallStart($call->id, $call->name);
                ++$announced;
            }

            if (!empty($frame['done'])) {
                $finish = $frame['done_reason'] ?? null;
                $usage = $this->extractUsage($frame);
            }
        }

        foreach ($collected as $call) {
            yield AiStreamEvent::toolCall($call);
        }

        if ($usage !== []) {
            yield AiStreamEvent::usage($usage);
        }

        if ($collected === [] && $text !== '') {
            $this->storeText($request, $text);
        }

        yield AiStreamEvent::done($this->mapFinishReason($finish, $collected));
    }

    /*
    |--------------------------------------------------------------------------
    | Payload
    |--------------------------------------------------------------------------
    */

    protected function buildPayload(AiRequest $request, bool $stream): array
    {
        $payload = [
            'model' => $this->resolveModel($request),
            'messages' => $this->buildMessages($request),
            'stream' => $stream,
            // Native Ollama exposes thinking as an explicit request switch.
            // Carry the panel setting on every turn so "off" is real too;
            // merely parsing message.thinking made the control display-only.
            'think' => $request->reasoning,
            'keep_alive' => $this->providerConfig->keepAlive,
            'options' => [
                'num_ctx' => $this->resolveContextWindow($request),
                // Without num_predict Ollama may generate until the context is
                // exhausted, producing runaway latency on an agent step.
                'num_predict' => $this->resolveMaxTokens($request),
                'temperature' => $this->resolveTemperature($request),
            ],
        ];

        // `format` and `tools` are mutually exclusive in practice: a grammar
        // that forces one JSON shape prevents the model from emitting the
        // tool-call structure. The repair path deliberately drops tools and
        // asks for the call as schema-constrained JSON instead.
        if ($request->responseSchema !== null) {
            $payload['format'] = $request->responseSchema;
        } elseif ($request->hasTools()) {
            $payload['tools'] = array_map(fn (AiTool $t) => $t->toOpenAiFormat(), $request->tools);
        }

        return $payload;
    }

    /**
     * Route one content delta between the answer and the reasoning channel.
     *
     * Reasoning models that Ollama has no template for wrap their reasoning in
     * `<think>…</think>` inside ordinary content. A tag can straddle two
     * deltas, so the open state is carried by reference across calls rather than
     * inferred from the fragment in hand.
     *
     * A tag split across the boundary — `<thi` then `nk>` — is the one case not
     * handled, and deliberately: buffering to cover it would stall the visible
     * stream on every delta to catch something Ollama emits whole.
     *
     * @return array<int, array{0: string, 1: string}> channel and piece, in order
     */
    protected function splitReasoning(string $delta, bool &$inThink): array
    {
        if (!$inThink && !str_contains($delta, '<think>')) {
            return [['text', $delta]];
        }

        $pieces = [];
        $rest = $delta;

        while ($rest !== '') {
            if ($inThink) {
                $close = strpos($rest, '</think>');
                if ($close === false) {
                    $pieces[] = ['reasoning', $rest];
                    break;
                }

                $pieces[] = ['reasoning', substr($rest, 0, $close)];
                $rest = substr($rest, $close + 8);
                $inThink = false;

                continue;
            }

            $open = strpos($rest, '<think>');
            if ($open === false) {
                $pieces[] = ['text', $rest];
                break;
            }

            $pieces[] = ['text', substr($rest, 0, $open)];
            $rest = substr($rest, $open + 7);
            $inThink = true;
        }

        return array_values(array_filter($pieces, fn (array $p) => $p[1] !== ''));
    }

    protected function buildMessages(AiRequest $request): array
    {
        $messages = [];

        $system = $this->resolveSystemPrompt($request);
        if ($system !== '') {
            $messages[] = ['role' => AiMessage::ROLE_SYSTEM, 'content' => $system];
        }

        foreach ($request->messages as $message) {
            $messages[] = $this->serialiseMessage($message);
        }

        return $messages;
    }

    protected function serialiseMessage(AiMessage $message): array
    {
        if ($message->role === AiMessage::ROLE_TOOL) {
            // Ollama has no tool-call ids; it correlates results by name and
            // order, so tool_name is what makes a multi-call turn resolvable.
            return array_filter([
                'role' => 'tool',
                'tool_name' => $message->toolName,
                'content' => (string) $message->content,
            ], fn ($v) => $v !== null);
        }

        if ($message->role === AiMessage::ROLE_ASSISTANT && $message->hasToolCalls()) {
            return [
                'role' => 'assistant',
                'content' => $message->content ?? '',
                'tool_calls' => array_map(fn (AiToolCall $c) => [
                    // Native API takes arguments as an object, not a JSON string.
                    'function' => [
                        'name' => $c->name,
                        'arguments' => $c->arguments ?: new \stdClass(),
                    ],
                ], $message->toolCalls),
            ];
        }

        return [
            'role' => $message->role,
            'content' => (string) $message->content,
        ];
    }

    /**
     * Size the context window to what this turn actually needs.
     *
     * num_ctx is the single most expensive knob on self-hosted hardware — VRAM
     * scales with it — so it is computed per request rather than pinned high.
     */
    protected function resolveContextWindow(AiRequest $request): int
    {
        $needed = TokenEstimator::forRequest($request, $this->resolveSystemPrompt($request))
            + $this->resolveMaxTokens($request)
            + self::CONTEXT_HEADROOM;

        // Round to the next power of two: llama.cpp allocates its KV cache in
        // buckets, so arbitrary values waste memory without buying window.
        $rounded = max(self::MIN_CONTEXT, 2 ** (int) ceil(log(max($needed, 1), 2)));

        return (int) min($rounded, max($this->contextCeiling(), self::MIN_CONTEXT));
    }

    /**
     * The largest context window this model will accept.
     *
     * Memoised because it is consulted while building every payload: without
     * an explicit setting it comes from the capability probe, and firing an
     * extra `/api/show` round trip per inference request would be a needless
     * dependency on a call that can fail.
     */
    protected function contextCeiling(): int
    {
        if ($this->contextCeiling !== null) {
            return $this->contextCeiling;
        }

        if ($this->providerConfig->contextTokens !== null) {
            return $this->contextCeiling = $this->providerConfig->contextTokens;
        }

        return $this->contextCeiling = $this->capabilities()->maxContextTokens ?? self::DEFAULT_MAX_CONTEXT;
    }

    /*
    |--------------------------------------------------------------------------
    | Parsing
    |--------------------------------------------------------------------------
    */

    /**
     * @return AiToolCall[]
     */
    protected function parseToolCalls(mixed $raw, int $offset = 0): array
    {
        if (!is_array($raw)) {
            return [];
        }

        $calls = [];
        foreach (array_values($raw) as $index => $call) {
            $name = $call['function']['name'] ?? null;
            if (!is_string($name) || $name === '') {
                continue;
            }

            $arguments = $call['function']['arguments'] ?? [];
            if (is_string($arguments)) {
                $decoded = json_decode($arguments, true);
                $arguments = is_array($decoded) ? $decoded : [];
            }

            $calls[] = new AiToolCall(
                $this->ensureCallId((string) ($call['id'] ?? ''), $offset + $index),
                $name,
                is_array($arguments) ? $arguments : [],
            );
        }

        return $calls;
    }

    protected function extractUsage(array $frame): array
    {
        $usage = $this->normaliseUsage(
            isset($frame['prompt_eval_count']) ? (int) $frame['prompt_eval_count'] : null,
            isset($frame['eval_count']) ? (int) $frame['eval_count'] : null,
        );

        if (isset($frame['eval_duration']) && is_numeric($frame['eval_duration'])) {
            $usage['generation_duration_ms'] = (float) $frame['eval_duration'] / 1_000_000;
            $usage['generation_timing_source'] = 'ollama_eval_duration';
        }

        return $usage;
    }

    /*
    |--------------------------------------------------------------------------
    | Probes
    |--------------------------------------------------------------------------
    */

    /**
     * Ask Ollama what the model can do.
     *
     * `/api/show` reports a `capabilities` array; if `tools` is absent the
     * model physically cannot emit tool calls and the agent must refuse to run
     * on it rather than degrade into prose that looks like a plan.
     */
    public function capabilities(?string $model = null): ProviderCapabilities
    {
        $model = $model ?: $this->providerConfig->model;

        if ($model === '') {
            return ProviderCapabilities::unknown('No model is selected.');
        }

        $key = 'ai:capabilities:' . sha1($this->providerConfig->endpoint . '|' . $model);

        return Cache::remember($key, self::PROBE_CACHE_TTL, function () use ($model) {
            try {
                $data = $this->postJson($this->nativePath('show'), ['model' => $model]);
            } catch (\Throwable $e) {
                return ProviderCapabilities::unknown(
                    'Could not query the model on this endpoint: ' . $e->getMessage()
                );
            }

            $capabilities = is_array($data['capabilities'] ?? null) ? $data['capabilities'] : [];
            $supportsTools = in_array('tools', $capabilities, true);

            $warnings = [];
            if (!$supportsTools) {
                $warnings[] = $capabilities === []
                    ? sprintf('This Ollama build does not report model capabilities, so tool support for "%s" could not be confirmed. Upgrade Ollama, or pick a model documented to support tools (qwen3, llama3.1, llama3.3, mistral-nemo).', $model)
                    : sprintf('The model "%s" does not support tool calling, so the AI agent cannot run on it. Choose a tool-capable model such as qwen3, llama3.1, llama3.3 or mistral-nemo.', $model);
            }

            return new ProviderCapabilities(
                supportsTools: $supportsTools,
                supportsStructuredOutput: true,
                supportsParallelToolCalls: true,
                supportsReasoning: in_array('thinking', $capabilities, true),
                selfHosted: true,
                maxContextTokens: $this->extractContextLength($data['model_info'] ?? []),
                modelSizeBytes: isset($data['size']) ? (int) $data['size'] : null,
                modelParameterCount: $this->extractParameterCount(
                    $data['details'] ?? [],
                    $data['model_info'] ?? [],
                ),
                warnings: $warnings,
            );
        });
    }

    /**
     * The context-length key in `model_info` is namespaced by architecture
     * (`qwen3.context_length`, `llama.context_length`, …), so match on suffix.
     */
    protected function extractContextLength(mixed $modelInfo): ?int
    {
        if (!is_array($modelInfo)) {
            return null;
        }

        foreach ($modelInfo as $key => $value) {
            if (is_string($key) && str_ends_with($key, '.context_length') && is_numeric($value)) {
                return (int) $value;
            }
        }

        return null;
    }

    /**
     * Prefer the exact GGUF count, then Ollama's human-readable `4.3B` label.
     */
    protected function extractParameterCount(mixed $details, mixed $modelInfo): ?int
    {
        if (is_array($modelInfo)) {
            $count = $modelInfo['general.parameter_count'] ?? null;
            if (is_numeric($count) && (int) $count > 0) {
                return (int) $count;
            }
        }

        $label = is_array($details) ? ($details['parameter_size'] ?? null) : null;
        if (!is_string($label) || preg_match('/(\d+(?:\.\d+)?)\s*([BM])/i', $label, $match) !== 1) {
            return null;
        }

        $multiplier = strtoupper($match[2]) === 'B' ? 1_000_000_000 : 1_000_000;

        return (int) round((float) $match[1] * $multiplier);
    }

    public function listModels(): array
    {
        try {
            $data = $this->getJson($this->nativePath('tags'), $this->providerConfig->connectTimeout);

            if (is_array($data['models'] ?? null)) {
                return array_values(array_map(fn ($m) => [
                    'id' => (string) ($m['name'] ?? $m['model'] ?? 'unknown'),
                    'size' => isset($m['size']) ? (int) $m['size'] : null,
                ], $data['models']));
            }
        } catch (\Throwable $e) {
            Log::warning('Ollama tag listing failed; falling back to /v1/models.', [
                'exception' => $e::class,
            ]);
        }

        $data = $this->getJson('models', $this->providerConfig->connectTimeout);

        return array_values(array_map(
            fn ($m) => ['id' => (string) ($m['id'] ?? 'unknown'), 'size' => null],
            $data['data'] ?? []
        ));
    }

    public function health(): bool
    {
        try {
            $data = $this->getJson($this->nativePath('tags'), $this->providerConfig->connectTimeout);

            return isset($data['models']);
        } catch (\Throwable $e) {
            Log::warning('Ollama health check failed.', [
                'exception' => $e::class,
            ]);

            return false;
        }
    }

    /**
     * Models currently resident in memory, with their VRAM footprint and
     * unload deadline. Drives the admin inference card and lets the queue
     * report whether a request will pay a cold-load penalty.
     *
     * @return array<int, array{name: string, size: int|null, size_vram: int|null, expires_at: string|null}>
     */
    public function runningModels(): array
    {
        try {
            $data = $this->getJson($this->nativePath('ps'), $this->providerConfig->connectTimeout);
        } catch (\Throwable $e) {
            return [];
        }

        return array_values(array_map(fn ($m) => [
            'name' => (string) ($m['name'] ?? $m['model'] ?? 'unknown'),
            'size' => isset($m['size']) ? (int) $m['size'] : null,
            'size_vram' => isset($m['size_vram']) ? (int) $m['size_vram'] : null,
            'expires_at' => isset($m['expires_at']) ? (string) $m['expires_at'] : null,
        ], is_array($data['models'] ?? null) ? $data['models'] : []));
    }

    /**
     * Load the model into memory without generating anything, re-asserting
     * keep_alive. Called on a schedule to eliminate cold starts.
     */
    public function warm(): bool
    {
        if ($this->providerConfig->model === '') {
            return false;
        }

        try {
            $this->postJson($this->nativePath('generate'), [
                'model' => $this->providerConfig->model,
                'keep_alive' => $this->providerConfig->keepAlive,
            ]);

            return true;
        } catch (\Throwable $e) {
            Log::warning('AI model warm-up failed.', [
                'exception' => $e::class,
            ]);

            return false;
        }
    }

    /**
     * Ollama's native API sits at the endpoint root, not under the
     * OpenAI-compatible `/v1` prefix the Guzzle base_uri points at.
     */
    protected function nativePath(string $path): string
    {
        return $this->providerConfig->endpointRoot() . '/api/' . ltrim($path, '/');
    }
}
