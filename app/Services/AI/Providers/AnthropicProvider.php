<?php

namespace Everest\Services\AI\Providers;

use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Data\ProviderCapabilities;
use Everest\Exceptions\Service\AI\AIServiceException;

/**
 * Anthropic Messages API driver.
 *
 * Three things differ from the OpenAI-shaped providers and are easy to get
 * wrong: the system prompt is a top-level field rather than a message, tool
 * results are content blocks inside a *user* message (and consecutive ones
 * must be merged into a single message), and current models reject sampling
 * parameters outright rather than ignoring them.
 */
class AnthropicProvider extends AbstractProvider
{
    public const API_VERSION = '2023-06-01';

    protected const MESSAGES_PATH = 'messages';

    /**
     * Models that reject `temperature`, `top_p`, and `top_k` with a 400.
     * Matched by prefix so dated snapshots and aliases both resolve.
     *
     * The agent loop pins temperature to 0 during tool selection, which would
     * hard-fail on these — so the driver drops the parameter instead of
     * passing it through. Reasoning depth is controlled by `effort` there.
     */
    protected const REJECTS_SAMPLING_PARAMS = [
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-sonnet-5',
        'claude-fable-5',
        'claude-mythos-5',
    ];

    /**
     * Models taking `thinking: {type: adaptive}`, where the model decides how
     * long to think rather than being handed a fixed token budget.
     *
     * Wider than REJECTS_SAMPLING_PARAMS: the 4.6 pair accepts sampling
     * parameters but reasons adaptively too. Older models take a
     * `budget_tokens` form that is not worth carrying — they are not what
     * anyone points an agent at.
     */
    protected const SUPPORTS_ADAPTIVE_THINKING = [
        'claude-opus-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-sonnet-5',
        'claude-sonnet-4-6',
        'claude-fable-5',
        'claude-mythos-5',
    ];

    /**
     * Headroom for a reasoning request.
     *
     * `max_tokens` bounds thinking *and* the answer together, and the panel
     * default is sized for a chat reply. Left alone, a model would spend the
     * whole allowance thinking and stop at `max_tokens` with its tool call
     * half-written. This is a ceiling, not a reservation — unused tokens are
     * not billed.
     */
    protected const REASONING_MIN_MAX_TOKENS = 8192;

    protected function headers(): array
    {
        return [
            'Content-Type' => 'application/json',
            'x-api-key' => $this->providerConfig->apiKey,
            'anthropic-version' => self::API_VERSION,
        ];
    }

    public function chat(AiRequest $request): AiResponse
    {
        $this->assertConfigured();

        if (($cached = $this->cachedText($request)) !== null) {
            return new AiResponse($cached, model: $this->resolveModel($request), cached: true);
        }

        $data = $this->postJson(static::MESSAGES_PATH, $this->buildPayload($request, false));

        $text = '';
        $toolCalls = [];

        foreach ($data['content'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'text') {
                $text .= (string) ($block['text'] ?? '');
            } elseif (($block['type'] ?? '') === 'tool_use') {
                $toolCalls[] = new AiToolCall(
                    (string) ($block['id'] ?? ''),
                    (string) ($block['name'] ?? ''),
                    is_array($block['input'] ?? null) ? $block['input'] : [],
                );
            }
        }

        $stopReason = $data['stop_reason'] ?? null;
        $content = trim($text) !== '' ? trim($text) : null;

        if ($stopReason === 'refusal') {
            return new AiResponse(
                $content ?? $this->refusalMessage($data),
                finishReason: AiResponse::FINISH_REFUSAL,
                usage: $this->extractUsage($data['usage'] ?? []),
                model: $data['model'] ?? $this->resolveModel($request),
            );
        }

        if ($content !== null && $toolCalls === []) {
            $this->storeText($request, $content);
        }

        return new AiResponse(
            $content,
            $toolCalls,
            $this->mapFinishReason($stopReason, $toolCalls),
            $this->extractUsage($data['usage'] ?? []),
            $data['model'] ?? $this->resolveModel($request),
        );
    }

    public function stream(AiRequest $request): \Generator
    {
        $this->assertConfigured();

        if (($cached = $this->cachedText($request)) !== null) {
            yield from $this->replayCached($cached);

            return;
        }

        $body = $this->postStream(static::MESSAGES_PATH, $this->buildPayload($request, true));

        // Tool arguments stream as `input_json_delta` fragments scoped to the
        // content block index they belong to, so accumulate per index and
        // finalise on content_block_stop.
        $blocks = [];
        $thoughts = [];
        $text = '';
        $collected = [];
        $stopReason = null;
        $inputTokens = null;
        $outputTokens = null;
        $cacheRead = 0;
        $cacheWrite = 0;

        foreach ($this->readSse($body) as $frame) {
            $data = $this->decodeSseData($frame['data']);
            if ($data === null) {
                continue;
            }

            $type = $frame['event'] ?? ($data['type'] ?? '');

            switch ($type) {
                case 'message_start':
                    // Includes the cache read/write counts, which sit outside
                    // `input_tokens` and would otherwise go unbilled.
                    $startUsage = is_array($data['message']['usage'] ?? null) ? $data['message']['usage'] : [];
                    $inputTokens = self::promptTokens($startUsage);
                    $cacheRead = (int) ($startUsage['cache_read_input_tokens'] ?? 0);
                    $cacheWrite = (int) ($startUsage['cache_creation_input_tokens'] ?? 0);
                    break;

                case 'content_block_start':
                    $index = (int) ($data['index'] ?? 0);
                    $block = $data['content_block'] ?? [];

                    if (($block['type'] ?? '') === 'tool_use') {
                        $blocks[$index] = [
                            'id' => (string) ($block['id'] ?? ''),
                            'name' => (string) ($block['name'] ?? ''),
                            'json' => '',
                        ];

                        yield AiStreamEvent::toolCallStart($blocks[$index]['id'], $blocks[$index]['name']);
                    } elseif (($block['type'] ?? '') === 'thinking') {
                        $thoughts[$index] = ['type' => 'thinking', 'thinking' => '', 'signature' => ''];
                    } elseif (($block['type'] ?? '') === 'redacted_thinking') {
                        // Encrypted by the API rather than shown. Nothing to
                        // display, but it still has to be echoed back or the
                        // assistant turn is incomplete.
                        $thoughts[$index] = [
                            'type' => 'redacted_thinking',
                            'data' => (string) ($block['data'] ?? ''),
                        ];
                    }
                    break;

                case 'content_block_delta':
                    $index = (int) ($data['index'] ?? 0);
                    $delta = $data['delta'] ?? [];

                    if (($delta['type'] ?? '') === 'text_delta') {
                        $piece = (string) ($delta['text'] ?? '');
                        if ($piece !== '') {
                            $text .= $piece;

                            yield AiStreamEvent::text($piece);
                        }
                    } elseif (($delta['type'] ?? '') === 'thinking_delta' && isset($thoughts[$index])) {
                        $piece = (string) ($delta['thinking'] ?? '');
                        if ($piece !== '') {
                            $thoughts[$index]['thinking'] .= $piece;

                            yield AiStreamEvent::reasoning($piece);
                        }
                    } elseif (($delta['type'] ?? '') === 'signature_delta' && isset($thoughts[$index])) {
                        // The block is rejected on the next request without
                        // this, so it is accumulated rather than displayed.
                        $thoughts[$index]['signature'] .= (string) ($delta['signature'] ?? '');
                    } elseif (($delta['type'] ?? '') === 'input_json_delta' && isset($blocks[$index])) {
                        $blocks[$index]['json'] .= (string) ($delta['partial_json'] ?? '');
                    }
                    break;

                case 'content_block_stop':
                    $index = (int) ($data['index'] ?? 0);
                    if (isset($blocks[$index])) {
                        $call = AiToolCall::fromJsonArguments(
                            $blocks[$index]['id'],
                            $blocks[$index]['name'],
                            // An empty fragment stream means a no-argument call.
                            $blocks[$index]['json'] !== '' ? $blocks[$index]['json'] : '{}',
                        );
                        $collected[] = $call;
                        unset($blocks[$index]);

                        yield AiStreamEvent::toolCall($call);
                    } elseif (isset($thoughts[$index])) {
                        yield AiStreamEvent::reasoningBlock($thoughts[$index]);

                        unset($thoughts[$index]);
                    }
                    break;

                case 'message_delta':
                    $stopReason = $data['delta']['stop_reason'] ?? $stopReason;
                    $outputTokens = $data['usage']['output_tokens'] ?? $outputTokens;
                    break;

                case 'error':
                    throw new AIServiceException('AI service error: ' . (string) ($data['error']['message'] ?? 'Unknown error'));
            }
        }

        $usage = $this->normaliseUsage(
            $inputTokens !== null ? (int) $inputTokens : null,
            $outputTokens !== null ? (int) $outputTokens : null,
        );

        if ($usage !== []) {
            yield AiStreamEvent::usage($usage + [
                'cache_read_tokens' => $cacheRead,
                'cache_write_tokens' => $cacheWrite,
            ]);
        }

        if ($stopReason === 'refusal') {
            yield AiStreamEvent::done(AiResponse::FINISH_REFUSAL);

            return;
        }

        if ($collected === [] && $text !== '') {
            $this->storeText($request, $text);
        }

        yield AiStreamEvent::done($this->mapFinishReason($stopReason, $collected));
    }

    /*
    |--------------------------------------------------------------------------
    | Payload
    |--------------------------------------------------------------------------
    */

    protected function buildPayload(AiRequest $request, bool $stream): array
    {
        $model = $this->resolveModel($request);
        $thinking = $request->reasoning && $this->supportsAdaptiveThinking($model);

        $payload = [
            'model' => $model,
            // Required by the Messages API — unlike the OpenAI shape, there is
            // no server-side default.
            'max_tokens' => $thinking
                ? max($this->resolveMaxTokens($request), self::REASONING_MIN_MAX_TOKENS)
                : $this->resolveMaxTokens($request),
            'messages' => $this->buildMessages($request),
            'stream' => $stream,
            // Automatic caching: one top-level breakpoint that the API keeps
            // moving to the end of the cacheable prefix as the conversation
            // grows. An agent turn re-sends the system prompt, every tool
            // schema and the whole transcript on each of up to twelve steps,
            // so nearly all of that prefix is identical to the step before.
            //
            // Reads bill at a tenth of the input rate, so this is a large net
            // saving despite the 25% write premium. Prompts under the model's
            // minimum cacheable size are silently not cached and cost nothing
            // extra, which is why this needs no threshold check of its own.
            'cache_control' => ['type' => 'ephemeral'],
        ];

        $system = $this->resolveSystemPrompt($request);
        if ($system !== '') {
            $payload['system'] = $system;
        }

        // Sampling parameters and thinking are mutually exclusive: a model that
        // takes both rejects temperature once thinking is on.
        if ($thinking) {
            $payload['thinking'] = ['type' => 'adaptive'];
        } elseif (!$this->rejectsSamplingParams($model)) {
            $payload['temperature'] = $this->resolveTemperature($request);
        }

        if ($request->hasTools()) {
            $payload['tools'] = array_map(fn (AiTool $t) => $t->toAnthropicFormat(), $request->tools);
            $payload['tool_choice'] = $this->mapToolChoice($request->toolChoice);
        }

        return $payload;
    }

    /**
     * Whether this model rejects sampling parameters with a 400.
     */
    protected function rejectsSamplingParams(string $model): bool
    {
        return $this->matchesPrefix($model, self::REJECTS_SAMPLING_PARAMS);
    }

    protected function supportsAdaptiveThinking(string $model): bool
    {
        return $this->matchesPrefix($model, self::SUPPORTS_ADAPTIVE_THINKING);
    }

    /**
     * Matched by prefix so dated snapshots and aliases both resolve.
     *
     * @param string[] $prefixes
     */
    protected function matchesPrefix(string $model, array $prefixes): bool
    {
        foreach ($prefixes as $prefix) {
            if (str_starts_with($model, $prefix)) {
                return true;
            }
        }

        return false;
    }

    protected function mapToolChoice(string $choice): array
    {
        return match ($choice) {
            AiRequest::TOOL_CHOICE_REQUIRED => ['type' => 'any'],
            AiRequest::TOOL_CHOICE_NONE => ['type' => 'none'],
            default => ['type' => 'auto'],
        };
    }

    /**
     * Convert the canonical message list into Anthropic's shape.
     *
     * Tool results are user-role content blocks, and the API expects every
     * result for one assistant turn in a *single* user message — splitting
     * them across messages trains the model out of parallel tool calls, so
     * consecutive tool messages are merged here.
     */
    protected function buildMessages(AiRequest $request): array
    {
        $messages = [];
        $pendingResults = [];

        $flush = function () use (&$messages, &$pendingResults): void {
            if ($pendingResults !== []) {
                $messages[] = ['role' => 'user', 'content' => $pendingResults];
                $pendingResults = [];
            }
        };

        foreach ($request->messages as $message) {
            if ($message->role === AiMessage::ROLE_TOOL) {
                $pendingResults[] = array_filter([
                    'type' => 'tool_result',
                    'tool_use_id' => $message->toolCallId,
                    'content' => (string) $message->content,
                    'is_error' => $message->isError ?: null,
                ], fn ($v) => $v !== null);

                continue;
            }

            $flush();

            // A system message inside the history has nowhere to go in this
            // API — fold it into the user turn rather than dropping it.
            if ($message->role === AiMessage::ROLE_SYSTEM) {
                $messages[] = ['role' => 'user', 'content' => (string) $message->content];

                continue;
            }

            if ($message->role === AiMessage::ROLE_ASSISTANT && $message->hasToolCalls()) {
                // Thinking first, and unaltered. The API verifies the signature
                // against the block's exact text, so this is the one thing in
                // the transcript that must survive a round trip through the
                // database byte for byte.
                $content = $this->thinkingBlocks($message);

                if ($message->content !== null && trim($message->content) !== '') {
                    $content[] = ['type' => 'text', 'text' => $message->content];
                }
                foreach ($message->toolCalls as $call) {
                    $content[] = [
                        'type' => 'tool_use',
                        'id' => $call->id,
                        'name' => $call->name,
                        'input' => $call->arguments ?: new \stdClass(),
                    ];
                }

                $messages[] = ['role' => 'assistant', 'content' => $content];

                continue;
            }

            $messages[] = ['role' => $message->role, 'content' => (string) $message->content];
        }

        $flush();

        return $messages;
    }

    /**
     * This message's reasoning, in the shape the API accepts back.
     *
     * Filtered rather than trusted: `AiMessage::$reasoning` is opaque storage
     * that may have been written by a different provider entirely if the
     * operator switched between a suspension and its resume, and an unsigned or
     * foreign block is a 400 rather than something the API ignores.
     */
    protected function thinkingBlocks(AiMessage $message): array
    {
        $blocks = [];

        foreach ($message->reasoning as $block) {
            $type = $block['type'] ?? '';

            if ($type === 'thinking' && ($block['signature'] ?? '') !== '' && ($block['thinking'] ?? '') !== '') {
                $blocks[] = [
                    'type' => 'thinking',
                    'thinking' => (string) $block['thinking'],
                    'signature' => (string) $block['signature'],
                ];
            } elseif ($type === 'redacted_thinking' && ($block['data'] ?? '') !== '') {
                $blocks[] = ['type' => 'redacted_thinking', 'data' => (string) $block['data']];
            }
        }

        return $blocks;
    }

    protected function extractUsage(array $usage): array
    {
        $normalised = $this->normaliseUsage(
            self::promptTokens($usage),
            isset($usage['output_tokens']) ? (int) $usage['output_tokens'] : null,
        );

        if ($normalised === []) {
            return [];
        }

        // Carried separately so the admin overview can show caching working;
        // both are already counted inside prompt_tokens.
        return $normalised + [
            'cache_read_tokens' => (int) ($usage['cache_read_input_tokens'] ?? 0),
            'cache_write_tokens' => (int) ($usage['cache_creation_input_tokens'] ?? 0),
        ];
    }

    /**
     * Total prompt tokens for a turn.
     *
     * `input_tokens` counts only what fell *outside* the cache breakpoint, so
     * reading it alone under-reports a cached request by most of the prompt —
     * which would quietly make token budgets stop binding as soon as caching
     * started working. Cached tokens are cheaper, not free, so all three are
     * summed.
     */
    protected static function promptTokens(array $usage): ?int
    {
        $keys = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];

        if (array_intersect_key($usage, array_flip($keys)) === []) {
            return null;
        }

        return array_sum(array_map(fn (string $key) => (int) ($usage[$key] ?? 0), $keys));
    }

    protected function refusalMessage(array $data): string
    {
        $category = $data['stop_details']['category'] ?? null;

        return $category
            ? sprintf('The AI provider declined this request (%s). Rephrasing it will not usually help.', $category)
            : 'The AI provider declined this request.';
    }

    /*
    |--------------------------------------------------------------------------
    | Probes
    |--------------------------------------------------------------------------
    */

    public function capabilities(?string $model = null): ProviderCapabilities
    {
        return new ProviderCapabilities(
            supportsTools: true,
            supportsStructuredOutput: true,
            selfHosted: false,
            maxContextTokens: $this->providerConfig->contextTokens,
        );
    }

    public function listModels(): array
    {
        $data = $this->getJson('models', $this->providerConfig->connectTimeout);

        return array_values(array_map(
            fn ($m) => ['id' => (string) ($m['id'] ?? 'unknown'), 'size' => null],
            $data['data'] ?? []
        ));
    }

    public function health(): bool
    {
        try {
            return $this->listModels() !== [];
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Anthropic health check failed: ' . $e->getMessage());

            return false;
        }
    }
}
