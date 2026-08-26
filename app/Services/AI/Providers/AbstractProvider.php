<?php

namespace Everest\Services\AI\Providers;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Psr\Http\Message\StreamInterface;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\RequestException;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Inference\ProviderReadiness;
use Everest\Exceptions\Service\AI\AIServiceException;

abstract class AbstractProvider implements AiProvider
{
    /**
     * How long completed responses are cached for. Identical prompts within this
     * window are served from cache instead of re-generating — a large win for
     * repeated crash analysis of the same log on self-hosted hardware.
     */
    public const RESPONSE_CACHE_TTL = 3600;

    /**
     * Health and capability probes are cheap but not free, and the admin UI
     * polls them. Short TTL keeps "I just fixed the endpoint" responsive.
     */
    public const PROBE_CACHE_TTL = 300;

    private ?Client $client = null;

    /** One opaque namespace for every missing-id call emitted by this response driver. */
    private string $syntheticCallNamespace;

    /**
     * @param callable|null $handler Guzzle handler override. Production leaves this
     *                               null; tests supply a MockHandler stack so the
     *                               real request construction is exercised rather
     *                               than stubbed out.
     */
    public function __construct(
        protected ProviderConfig $providerConfig,
        private $handler = null,
    ) {
        $this->beginToolCallResponse();
    }

    public function config(): ProviderConfig
    {
        return $this->providerConfig;
    }

    protected function client(): Client
    {
        return $this->client ??= new Client(array_filter([
            'base_uri' => $this->providerConfig->baseUri(),
            'timeout' => $this->providerConfig->timeout,
            'connect_timeout' => $this->providerConfig->connectTimeout,
            // A configured provider endpoint is an explicit trust decision. Do
            // not let that host redirect credentials or requests to a second,
            // unreviewed network location.
            'allow_redirects' => false,
            'handler' => $this->handler,
        ]));
    }

    /**
     * Headers sent on every request. Drivers override to add their own auth
     * scheme (Anthropic uses x-api-key + anthropic-version, not Bearer).
     */
    protected function headers(): array
    {
        $headers = ['Content-Type' => 'application/json'];

        if ($this->providerConfig->apiKey !== '') {
            $headers['Authorization'] = 'Bearer ' . $this->providerConfig->apiKey;
        }

        return $headers;
    }

    /**
     * @throws AIServiceException
     */
    protected function assertConfigured(): void
    {
        if ($this->providerConfig->requiresApiKey() && $this->providerConfig->apiKey === '') {
            throw new AIServiceException('AI API key is not configured.');
        }

        if ($this->providerConfig->endpoint === '') {
            throw new AIServiceException('AI endpoint is not configured.');
        }
    }

    protected function resolveModel(AiRequest $request): string
    {
        return $request->model ?: $this->providerConfig->model;
    }

    protected function resolveMaxTokens(AiRequest $request): int
    {
        return $request->maxTokens ?? $this->providerConfig->maxTokens;
    }

    /**
     * Tool-selection benefits from determinism far more than prose does, so the
     * agent loop pins temperature to 0 while tools are on the table and only
     * relaxes it for the final answer.
     */
    protected function resolveTemperature(AiRequest $request): float
    {
        return $request->temperature ?? $this->providerConfig->temperature;
    }

    protected function resolveSystemPrompt(AiRequest $request): string
    {
        return $request->systemPrompt ?? $this->providerConfig->systemPrompt;
    }

    /*
    |--------------------------------------------------------------------------
    | Response cache
    |--------------------------------------------------------------------------
    */

    /**
     * Requests carrying tools are never cached. A cached turn would replay a
     * stale plan built against a filesystem that has since changed, and the
     * saving is illusory anyway — agent histories almost never repeat verbatim.
     */
    protected function isCacheable(AiRequest $request): bool
    {
        return !$request->noCache && !$request->hasTools() && $request->responseSchema === null;
    }

    protected function responseCacheKey(AiRequest $request): string
    {
        return 'ai:response:' . sha1(json_encode([
            $this->providerConfig->fingerprint(),
            $this->resolveModel($request),
            $this->resolveSystemPrompt($request),
            $this->resolveTemperature($request),
            $this->resolveMaxTokens($request),
            array_map(fn ($m) => $m->toArray(), $request->messages),
        ]));
    }

    protected function cachedText(AiRequest $request): ?string
    {
        if (!$this->isCacheable($request)) {
            return null;
        }

        $cached = Cache::get($this->responseCacheKey($request));

        return is_string($cached) && $cached !== '' ? $cached : null;
    }

    protected function storeText(AiRequest $request, string $text): void
    {
        if ($this->isCacheable($request) && trim($text) !== '') {
            Cache::put($this->responseCacheKey($request), trim($text), self::RESPONSE_CACHE_TTL);
        }
    }

    /**
     * Replay a cached answer as a stream so the UI still animates.
     *
     * @return \Generator<int, \Everest\Services\AI\Data\AiStreamEvent>
     */
    protected function replayCached(string $cached): \Generator
    {
        foreach (str_split($cached, 48) as $piece) {
            yield \Everest\Services\AI\Data\AiStreamEvent::text($piece);
        }

        yield \Everest\Services\AI\Data\AiStreamEvent::done(AiResponse::FINISH_STOP);
    }

    /*
    |--------------------------------------------------------------------------
    | Transport
    |--------------------------------------------------------------------------
    */

    /**
     * POST a JSON payload and decode the response.
     *
     * @throws AIServiceException
     */
    protected function postJson(string $path, array $payload): array
    {
        try {
            $response = $this->client()->post($path, [
                'headers' => $this->headers(),
                'json' => $payload,
            ]);
        } catch (GuzzleException $e) {
            throw $this->wrapTransportError($e);
        }

        $this->noteReachable();

        $decoded = json_decode($response->getBody()->getContents(), true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new AIServiceException('Failed to decode AI service response: ' . json_last_error_msg());
        }

        if (isset($decoded['error'])) {
            throw new AIServiceException('The AI provider returned an error.');
        }

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Open a streaming POST. `stream => true` tells Guzzle not to buffer the
     * body — without it the whole reply is collected before returning and the
     * UI spins until generation finishes.
     *
     * @throws AIServiceException
     */
    protected function postStream(string $path, array $payload): StreamInterface
    {
        try {
            $response = $this->client()->post($path, [
                'stream' => true,
                'headers' => $this->headers() + ['Accept' => 'text/event-stream'],
                'json' => $payload,
            ]);
        } catch (GuzzleException $e) {
            throw $this->wrapTransportError($e);
        }

        $this->noteReachable();

        return $response->getBody();
    }

    protected function wrapTransportError(GuzzleException $e): AIServiceException
    {
        $status = $e instanceof RequestException && $e->hasResponse()
            ? $e->getResponse()->getStatusCode()
            : null;

        // Provider errors are an untrusted data source. Bodies and exception
        // messages can echo the complete prompt, tool results or credentials,
        // so neither belongs in a long-lived operational log or a browser error.
        Log::error('AI provider transport error', array_filter([
            'provider' => $this->providerConfig->provider,
            'status' => $status,
            'exception' => $e::class,
        ], static fn (mixed $value): bool => $value !== null));

        // A request that never got a response is a service that is not there; a
        // 5xx is one that is there and cannot serve. Either way the next person
        // to send should be told immediately instead of waiting out the same
        // timeout again, so this failure stands in for a probe.
        //
        // A 4xx is the opposite, and recording it as reachable matters as much:
        // the endpoint answered. Not every OpenAI-compatible server implements
        // `/models`, and a 404 there must not be allowed to read as an outage
        // and lock the assistant out of a host that is running perfectly well.
        if ($status === null || $status >= 500) {
            $this->noteUnreachable();
        } else {
            $this->noteReachable();
        }

        return new AIServiceException('Failed to communicate with AI service.');
    }

    /**
     * A call that came back is the cheapest readiness evidence there is, and
     * recording it is what keeps an active conversation off the probe path.
     */
    protected function noteReachable(): void
    {
        app(ProviderReadiness::class)->markReachable($this->providerConfig);
    }

    protected function noteUnreachable(): void
    {
        app(ProviderReadiness::class)->markUnreachable(
            $this->providerConfig,
            ProviderReadiness::UNREACHABLE_MESSAGE,
        );
    }

    /**
     * Parse a Server-Sent Events body into dispatched events.
     *
     * Implements the SSE framing rules properly (fields accumulate until a
     * blank line dispatches) rather than assuming one `data:` per line, because
     * Anthropic and the OpenAI Responses API both rely on a preceding `event:`
     * line to disambiguate payloads that are otherwise shaped identically.
     *
     * @return \Generator<int, array{event: string|null, data: string}>
     */
    protected function readSse(StreamInterface $body): \Generator
    {
        $buffer = '';
        $event = null;
        $data = [];

        while (!$body->eof()) {
            $chunk = $body->read(8192);

            // A closed connection can return an empty string forever; bail
            // rather than spinning the CPU until the request times out.
            if ($chunk === '') {
                break;
            }

            $buffer .= $chunk;

            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = rtrim(substr($buffer, 0, $pos), "\r");
                $buffer = substr($buffer, $pos + 1);

                if ($line === '') {
                    if ($data !== []) {
                        yield ['event' => $event, 'data' => implode("\n", $data)];
                    }

                    $event = null;
                    $data = [];

                    continue;
                }

                // Comment frame — used as a proxy keep-alive.
                if (str_starts_with($line, ':')) {
                    continue;
                }

                if (str_starts_with($line, 'event:')) {
                    $event = trim(substr($line, 6));
                } elseif (str_starts_with($line, 'data:')) {
                    $data[] = ltrim(substr($line, 5), ' ');
                }
            }
        }

        // Some servers omit the trailing blank line on the final event.
        if ($data !== []) {
            yield ['event' => $event, 'data' => implode("\n", $data)];
        }
    }

    protected function decodeSseData(string $data): ?array
    {
        if ($data === '' || $data === '[DONE]') {
            return null;
        }

        $decoded = json_decode($data, true);

        return json_last_error() === JSON_ERROR_NONE && is_array($decoded) ? $decoded : null;
    }

    /**
     * Read a newline-delimited JSON stream, yielding each decoded object.
     *
     * Ollama's native API streams NDJSON rather than SSE, so it needs its own
     * framing even though the semantics are the same.
     *
     * @return \Generator<int, array>
     */
    protected function readNdjson(StreamInterface $body): \Generator
    {
        $buffer = '';

        while (!$body->eof()) {
            $chunk = $body->read(8192);

            if ($chunk === '') {
                break;
            }

            $buffer .= $chunk;

            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $pos));
                $buffer = substr($buffer, $pos + 1);

                if ($line === '') {
                    continue;
                }

                $decoded = json_decode($line, true);
                if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                    yield $decoded;
                }
            }
        }

        $line = trim($buffer);
        if ($line !== '') {
            $decoded = json_decode($line, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                yield $decoded;
            }
        }
    }

    /**
     * @throws AIServiceException
     */
    protected function getJson(string $path, ?int $timeout = null): array
    {
        try {
            $response = $this->client()->get($path, array_filter([
                'headers' => $this->headers(),
                'timeout' => $timeout,
            ]));
        } catch (GuzzleException $e) {
            throw $this->wrapTransportError($e);
        }

        $this->noteReachable();

        $decoded = json_decode($response->getBody()->getContents(), true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Tool results must reference the call they answer. Providers that omit ids
     * (Ollama's native API has no concept of one) still need a stable handle,
     * so synthesise it from both this provider response namespace and the call's
     * position. Provider instances are request-scoped; the namespace prevents a
     * later response's first call from reusing the old `call_0` identity.
     */
    protected function ensureCallId(string $id, int $index): string
    {
        // An id landing in the panel's own derived namespace is treated as
        // absent. A provider has no legitimate reason to emit one, and honouring
        // it would let a top-level call share an identity with a batch child.
        if ($id === '' || \Everest\Services\AI\Data\AiToolCall::isDerivedId($id)) {
            return sprintf('call_%s_%d', $this->syntheticCallNamespace, $index);
        }

        return $id;
    }

    /** Start a fresh identity namespace before parsing one provider response. */
    protected function beginToolCallResponse(): void
    {
        $this->syntheticCallNamespace = bin2hex(random_bytes(12));
    }

    /**
     * @param \Everest\Services\AI\Data\AiToolCall[] $toolCalls
     */
    protected function mapFinishReason(?string $reason, array $toolCalls): string
    {
        if ($toolCalls !== []) {
            return AiResponse::FINISH_TOOL_CALLS;
        }

        return match ($reason) {
            'tool_calls', 'function_call', 'tool_use' => AiResponse::FINISH_TOOL_CALLS,
            'length', 'max_tokens', 'max_output_tokens' => AiResponse::FINISH_LENGTH,
            default => AiResponse::FINISH_STOP,
        };
    }

    protected function normaliseUsage(?int $prompt, ?int $completion, ?int $total = null): array
    {
        if ($prompt === null && $completion === null && $total === null) {
            return [];
        }

        return [
            'prompt_tokens' => $prompt,
            'completion_tokens' => $completion,
            'total_tokens' => $total ?? (($prompt ?? 0) + ($completion ?? 0)),
        ];
    }
}
