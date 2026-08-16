<?php

namespace Everest\Services\AI\Data;

/**
 * Resolved connection settings for one provider.
 *
 * Built by ProviderFactory from the database-backed settings so that values
 * saved in the admin UI are always authoritative; config/env act as fallbacks
 * only. Drivers never read settings themselves.
 */
class ProviderConfig
{
    public const PROVIDER_ANTHROPIC = 'anthropic';
    public const PROVIDER_OPENAI = 'openai';
    public const PROVIDER_OPENAI_COMPATIBLE = 'openai_compatible';
    public const PROVIDER_OLLAMA = 'ollama';

    public const PROVIDERS = [
        self::PROVIDER_ANTHROPIC,
        self::PROVIDER_OPENAI,
        self::PROVIDER_OPENAI_COMPATIBLE,
        self::PROVIDER_OLLAMA,
    ];

    /**
     * Providers whose inference runs on hardware the panel operator owns.
     * These are the ones that need slot-based admission control — for hosted
     * providers the binding constraint is spend, which budgets already cover.
     */
    public const SELF_HOSTED = [
        self::PROVIDER_OLLAMA,
        self::PROVIDER_OPENAI_COMPATIBLE,
    ];

    public function __construct(
        public readonly string $provider,
        public readonly string $endpoint,
        public readonly string $apiKey = '',
        public readonly string $model = '',
        public readonly int $maxTokens = 1024,
        public readonly float $temperature = 0.3,
        public readonly string $systemPrompt = '',
        public readonly string $keepAlive = '10m',
        public readonly int $timeout = 300,
        public readonly int $connectTimeout = 10,
        public readonly ?int $contextTokens = null,
    ) {
    }

    public function isSelfHosted(): bool
    {
        return in_array($this->provider, self::SELF_HOSTED, true);
    }

    /**
     * Whether this provider refuses to work without credentials. Ollama and
     * other local OpenAI-compatible servers are normally unauthenticated.
     */
    public function requiresApiKey(): bool
    {
        return !$this->isSelfHosted();
    }

    public function baseUri(): string
    {
        return rtrim($this->endpoint, '/') . '/';
    }

    /**
     * The endpoint root without the OpenAI-compatible `/v1` suffix. Ollama's
     * native API (tags, show, ps, generate) lives there rather than under /v1.
     */
    public function endpointRoot(): string
    {
        return preg_replace('~/v1/?$~', '', rtrim($this->endpoint, '/'));
    }

    public function withModel(string $model): self
    {
        return new self(
            $this->provider,
            $this->endpoint,
            $this->apiKey,
            $model,
            $this->maxTokens,
            $this->temperature,
            $this->systemPrompt,
            $this->keepAlive,
            $this->timeout,
            $this->connectTimeout,
            $this->contextTokens,
        );
    }

    /**
     * Return a connection config whose blocking bounds cannot outlive the
     * caller's remaining wall-clock allowance.
     */
    public function withTimeout(int $seconds): self
    {
        $timeout = max(1, min($this->timeout, $seconds));

        return new self(
            $this->provider,
            $this->endpoint,
            $this->apiKey,
            $this->model,
            $this->maxTokens,
            $this->temperature,
            $this->systemPrompt,
            $this->keepAlive,
            $timeout,
            min($this->connectTimeout, $timeout),
            $this->contextTokens,
        );
    }

    /**
     * A stable fingerprint of everything that identifies this endpoint+model,
     * used to key health, capability, and model-listing caches.
     */
    public function fingerprint(): string
    {
        return sha1(implode('|', [$this->provider, $this->endpoint, $this->model]));
    }
}
