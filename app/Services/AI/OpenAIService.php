<?php

namespace Everest\Services\AI;

use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Providers\AbstractProvider;
use Everest\Exceptions\Service\AI\AIServiceException;

/**
 * Backwards-compatible facade over the provider drivers.
 *
 * Predates the multi-provider rework, when it was the entire provider layer.
 * It now delegates to whichever driver ProviderFactory resolves, keeping the
 * single-turn call sites (crash analysis, conversation titles, the admin
 * playground) working unchanged. New code should depend on ProviderFactory and
 * the AiProvider contract directly — those expose tool calling, which the
 * string-in/string-out shape here cannot.
 */
class OpenAIService
{
    /**
     * @deprecated use AbstractProvider::RESPONSE_CACHE_TTL
     */
    public const RESPONSE_CACHE_TTL = AbstractProvider::RESPONSE_CACHE_TTL;

    private ?AiProvider $provider = null;

    private array $lastUsage = [];

    private bool $lastResponseCached = false;

    public function __construct(private ProviderFactory $factory)
    {
    }

    /**
     * The resolved driver for one-shot work. Built lazily so constructing the
     * service never touches settings — several call sites inject it and then
     * bail on a feature flag before making a request.
     */
    protected function provider(): AiProvider
    {
        return $this->provider ??= $this->factory->make(ProviderFactory::TASK_FAST);
    }

    public function getLastUsage(): array
    {
        return $this->lastUsage;
    }

    public function wasCached(): bool
    {
        return $this->lastResponseCached;
    }

    /**
     * Send a single-turn query and return the completed text.
     *
     * @throws AIServiceException
     */
    public function query(string $prompt, array $options = []): string
    {
        $response = $this->provider()->chat(
            $this->buildRequest([AiMessage::user($prompt)], $options)
        );

        $this->lastResponseCached = $response->cached;
        $this->lastUsage = $response->usage + ['model' => $response->model];

        if ($response->finishReason === AiResponse::FINISH_REFUSAL) {
            throw new AIServiceException($response->content ?: 'The AI provider declined this request.');
        }

        return $response->content ?? '';
    }

    /**
     * Stream a query, yielding text chunks.
     *
     * `$options['messages']` may carry a pre-built multi-turn history of
     * `{role, content}` pairs, in which case `$prompt` is ignored.
     *
     * @return \Generator<int, string>
     *
     * @throws AIServiceException
     */
    public function queryStream(string $prompt, array $options = []): \Generator
    {
        $history = $options['messages'] ?? null;

        $messages = is_array($history) && $history !== []
            ? array_values(array_map(fn (array $m) => AiMessage::fromArray($m), $history))
            : [AiMessage::user($prompt)];

        $this->lastResponseCached = false;
        $this->lastUsage = [];

        foreach ($this->provider()->stream($this->buildRequest($messages, $options)) as $event) {
            switch ($event->type) {
                case Data\AiStreamEvent::TYPE_TEXT:
                    yield (string) $event->text;
                    break;

                case Data\AiStreamEvent::TYPE_USAGE:
                    $this->lastUsage = $event->usage;
                    break;

                case Data\AiStreamEvent::TYPE_ERROR:
                    throw new AIServiceException((string) $event->error);
            }
        }
    }

    /**
     * @param AiMessage[] $messages
     */
    protected function buildRequest(array $messages, array $options): AiRequest
    {
        return new AiRequest(
            messages: $messages,
            systemPrompt: $options['system_prompt'] ?? null,
            model: $options['model'] ?? null,
            maxTokens: isset($options['max_tokens']) ? (int) $options['max_tokens'] : null,
            temperature: isset($options['temperature']) ? (float) $options['temperature'] : null,
            noCache: (bool) ($options['no_cache'] ?? false),
        );
    }

    public function testConnection(): bool
    {
        return $this->provider()->health();
    }

    /**
     * @return array<int, array{id: string, size: int|null}>
     *
     * @throws AIServiceException
     */
    public function listModels(): array
    {
        return $this->provider()->listModels();
    }

    /**
     * Preload the configured model. No-op for providers that have no notion of
     * a resident model.
     */
    public function warm(): bool
    {
        $provider = $this->factory->make(ProviderFactory::TASK_FAST);

        return $provider instanceof OllamaProvider && $provider->warm();
    }
}
