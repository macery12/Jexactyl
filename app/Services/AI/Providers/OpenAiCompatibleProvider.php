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
 * Driver for any endpoint speaking the OpenAI `chat/completions` contract —
 * vLLM, LM Studio, OpenRouter, Groq, llama.cpp's server, and Ollama (which
 * subclasses this to add its native probe and runtime options).
 */
class OpenAiCompatibleProvider extends AbstractProvider
{
    protected const CHAT_PATH = 'chat/completions';

    public function chat(AiRequest $request): AiResponse
    {
        $this->assertConfigured();

        if (($cached = $this->cachedText($request)) !== null) {
            return new AiResponse($cached, model: $this->resolveModel($request), cached: true);
        }

        $data = $this->postJson(static::CHAT_PATH, $this->buildPayload($request, false));
        $choice = $data['choices'][0] ?? [];
        $message = $choice['message'] ?? [];

        $content = isset($message['content']) ? trim((string) $message['content']) : null;
        $toolCalls = $this->parseToolCalls($message['tool_calls'] ?? []);

        if ($content !== null && $toolCalls === []) {
            $this->storeText($request, $content);
        }

        return new AiResponse(
            $content,
            $toolCalls,
            $this->mapFinishReason($choice['finish_reason'] ?? null, $toolCalls),
            $this->parseUsage($data['usage'] ?? []),
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

        $body = $this->postStream(static::CHAT_PATH, $this->buildPayload($request, true));

        // Tool-call arguments arrive fragmented across chunks and are keyed by
        // an `index`, not by id — the id itself may only appear in the first
        // fragment. Accumulate per index and emit complete calls at the end.
        $pending = [];
        $started = [];
        $text = '';
        $finish = null;
        $usage = [];

        foreach ($this->readSse($body) as $frame) {
            $data = $this->decodeSseData($frame['data']);
            if ($data === null) {
                continue;
            }

            if (isset($data['error'])) {
                throw new AIServiceException('AI service error: ' . ($data['error']['message'] ?? 'Unknown error'));
            }

            if (isset($data['usage']) && is_array($data['usage'])) {
                $usage = $this->parseUsage($data['usage']);
            }

            $choice = $data['choices'][0] ?? null;
            if (!is_array($choice)) {
                continue;
            }

            if (!empty($choice['finish_reason'])) {
                $finish = (string) $choice['finish_reason'];
            }

            $delta = $choice['delta'] ?? [];

            // Reasoning models on this wire format put their thinking on a
            // sibling key rather than in `content`. There is no agreed name for
            // it — DeepSeek and vLLM use `reasoning_content`, OpenRouter and
            // Groq use `reasoning` — and nothing has to be echoed back, so both
            // are read and neither is required.
            foreach (['reasoning_content', 'reasoning'] as $key) {
                if (isset($delta[$key]) && is_string($delta[$key]) && $delta[$key] !== '') {
                    yield AiStreamEvent::reasoning($delta[$key]);

                    break;
                }
            }

            if (isset($delta['content']) && is_string($delta['content']) && $delta['content'] !== '') {
                $text .= $delta['content'];

                yield AiStreamEvent::text($delta['content']);
            }

            foreach ($this->normaliseToolCallDeltas($delta['tool_calls'] ?? []) as $index => $fragment) {
                $pending[$index] ??= ['id' => '', 'name' => '', 'arguments' => ''];

                if ($fragment['id'] !== '') {
                    $pending[$index]['id'] = $fragment['id'];
                }
                if ($fragment['name'] !== '') {
                    $pending[$index]['name'] = $fragment['name'];
                }
                $pending[$index]['arguments'] .= $fragment['arguments'];

                // Announce as soon as the name is known so the UI can show
                // "reading server.properties…" while arguments still stream.
                if (!isset($started[$index]) && $pending[$index]['name'] !== '') {
                    $started[$index] = true;

                    yield AiStreamEvent::toolCallStart(
                        $this->ensureCallId($pending[$index]['id'], $index),
                        $pending[$index]['name'],
                    );
                }
            }
        }

        ksort($pending);
        $emitted = [];

        foreach ($pending as $index => $call) {
            if ($call['name'] === '') {
                continue;
            }

            $toolCall = AiToolCall::fromJsonArguments(
                $this->ensureCallId($call['id'], $index),
                $call['name'],
                $call['arguments'],
            );
            $emitted[] = $toolCall;

            yield AiStreamEvent::toolCall($toolCall);
        }

        if ($usage !== []) {
            yield AiStreamEvent::usage($usage);
        }

        if ($emitted === [] && $text !== '') {
            $this->storeText($request, $text);
        }

        yield AiStreamEvent::done($this->mapFinishReason($finish, $emitted));
    }

    public function capabilities(?string $model = null): ProviderCapabilities
    {
        return new ProviderCapabilities(
            supportsTools: true,
            supportsStructuredOutput: true,
            selfHosted: $this->providerConfig->isSelfHosted(),
            maxContextTokens: $this->providerConfig->contextTokens,
        );
    }

    public function listModels(): array
    {
        $data = $this->getJson('models');

        return array_values(array_map(
            fn ($m) => ['id' => (string) ($m['id'] ?? 'unknown'), 'size' => null],
            $data['data'] ?? []
        ));
    }

    public function health(): bool
    {
        try {
            $data = $this->getJson('models', $this->providerConfig->connectTimeout);

            return isset($data['data']) || isset($data['models']);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('AI health check failed: ' . $e->getMessage());

            return false;
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Payload construction
    |--------------------------------------------------------------------------
    */

    protected function buildPayload(AiRequest $request, bool $stream): array
    {
        $payload = [
            'model' => $this->resolveModel($request),
            'messages' => $this->buildMessages($request),
            'max_tokens' => $this->resolveMaxTokens($request),
            'temperature' => $this->resolveTemperature($request),
            'stream' => $stream,
        ];

        if ($request->hasTools()) {
            $payload['tools'] = array_map(fn (AiTool $t) => $t->toOpenAiFormat(), $request->tools);
            $payload['tool_choice'] = $request->toolChoice;
        }

        if ($request->responseSchema !== null) {
            $payload['response_format'] = [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'tool_call_repair',
                    'schema' => $request->responseSchema,
                    'strict' => true,
                ],
            ];
        }

        if ($stream && $this->supportsStreamOptions()) {
            $payload['stream_options'] = ['include_usage' => true];
        }

        return $payload;
    }

    /**
     * Whether the endpoint understands `stream_options.include_usage`. Without
     * it a streamed call reports no token usage at all, which breaks budgeting.
     */
    protected function supportsStreamOptions(): bool
    {
        return true;
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
            return [
                'role' => 'tool',
                'tool_call_id' => $message->toolCallId,
                'content' => (string) $message->content,
            ];
        }

        if ($message->role === AiMessage::ROLE_ASSISTANT && $message->hasToolCalls()) {
            return [
                'role' => 'assistant',
                // The spec allows null content alongside tool_calls, but several
                // OpenAI-compatible servers reject null outright — send "".
                'content' => $message->content ?? '',
                'tool_calls' => array_map(fn (AiToolCall $c) => [
                    'id' => $c->id,
                    'type' => 'function',
                    'function' => [
                        'name' => $c->name,
                        'arguments' => json_encode($c->arguments ?: new \stdClass()),
                    ],
                ], $message->toolCalls),
            ];
        }

        return [
            'role' => $message->role,
            'content' => (string) $message->content,
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Response parsing
    |--------------------------------------------------------------------------
    */

    /**
     * @return AiToolCall[]
     */
    protected function parseToolCalls(mixed $raw): array
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

            $arguments = $call['function']['arguments'] ?? '';

            // Ollama returns arguments as an already-decoded object; OpenAI
            // returns a JSON string. Handle both without guessing.
            $calls[] = is_array($arguments)
                ? new AiToolCall($this->ensureCallId((string) ($call['id'] ?? ''), $index), $name, $arguments)
                : AiToolCall::fromJsonArguments(
                    $this->ensureCallId((string) ($call['id'] ?? ''), $index),
                    $name,
                    (string) $arguments,
                );
        }

        return $calls;
    }

    /**
     * Flatten a streamed `tool_calls` delta into `index => {id, name, arguments}`.
     *
     * @return array<int, array{id: string, name: string, arguments: string}>
     */
    protected function normaliseToolCallDeltas(mixed $raw): array
    {
        if (!is_array($raw)) {
            return [];
        }

        $out = [];
        foreach (array_values($raw) as $position => $fragment) {
            if (!is_array($fragment)) {
                continue;
            }

            // `index` is authoritative when present. Some servers omit it on
            // single-call responses, in which case array position is correct.
            $index = isset($fragment['index']) ? (int) $fragment['index'] : $position;
            $arguments = $fragment['function']['arguments'] ?? '';

            $out[$index] = [
                'id' => (string) ($fragment['id'] ?? ''),
                'name' => (string) ($fragment['function']['name'] ?? ''),
                'arguments' => is_string($arguments) ? $arguments : (string) json_encode($arguments),
            ];
        }

        return $out;
    }

    protected function parseUsage(array $usage): array
    {
        return $this->normaliseUsage(
            isset($usage['prompt_tokens']) ? (int) $usage['prompt_tokens'] : null,
            isset($usage['completion_tokens']) ? (int) $usage['completion_tokens'] : null,
            isset($usage['total_tokens']) ? (int) $usage['total_tokens'] : null,
        );
    }
}
