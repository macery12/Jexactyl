<?php

namespace Everest\Services\AI;

use Everest\Models\Setting;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Providers\AnthropicProvider;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Providers\OpenRouterProvider;
use Everest\Services\AI\Providers\OpenAiCompatibleProvider;

/**
 * Resolves the configured provider driver.
 *
 * This is the only place that reads AI settings. Drivers receive a fully
 * resolved ProviderConfig so they never touch the database, which keeps them
 * trivially testable against a fixed configuration.
 */
class ProviderFactory
{
    /**
     * Sensible endpoint per provider when the admin has not set one.
     */
    public const DEFAULT_ENDPOINTS = [
        ProviderConfig::PROVIDER_ANTHROPIC => 'https://api.anthropic.com/v1',
        ProviderConfig::PROVIDER_OPENAI => 'https://api.openai.com/v1',
        ProviderConfig::PROVIDER_OPENROUTER => OpenRouterProvider::ENDPOINT,
        ProviderConfig::PROVIDER_OLLAMA => 'http://127.0.0.1:11434/v1',
        ProviderConfig::PROVIDER_OPENAI_COMPATIBLE => '',
    ];

    /**
     * Build the configured provider, optionally bounded by a caller's remaining
     * wall-clock allowance.
     *
     * @throws AIServiceException
     */
    public function make(?int $timeoutSeconds = null): AiProvider
    {
        $config = $this->config();

        return $this->fromConfig(
            $timeoutSeconds === null ? $config : $config->withTimeout($timeoutSeconds)
        );
    }

    /**
     * @throws AIServiceException
     */
    public function fromConfig(ProviderConfig $config): AiProvider
    {
        if ($config->provider === ProviderConfig::PROVIDER_OPENROUTER) {
            $config = $this->canonicalOpenRouterConfig($config);
        }

        return match ($config->provider) {
            ProviderConfig::PROVIDER_ANTHROPIC => new AnthropicProvider($config),
            ProviderConfig::PROVIDER_OPENROUTER => new OpenRouterProvider($config),
            ProviderConfig::PROVIDER_OLLAMA => new OllamaProvider($config),
            ProviderConfig::PROVIDER_OPENAI,
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE => new OpenAiCompatibleProvider($config),
            default => throw new AIServiceException('Unsupported AI provider: ' . $config->provider),
        };
    }

    /** Resolve the effective connection and provider settings. */
    public function config(): ProviderConfig
    {
        $provider = $this->provider();

        $endpoint = (string) $this->setting('endpoint', config('modules.ai.endpoint'));
        if ($provider === ProviderConfig::PROVIDER_OPENROUTER) {
            $endpoint = OpenRouterProvider::ENDPOINT;
        } elseif ($endpoint === '') {
            $endpoint = self::DEFAULT_ENDPOINTS[$provider] ?? '';
        }

        $contextTokens = $this->setting('context_tokens', config('modules.ai.context_tokens'));

        return new ProviderConfig(
            provider: $provider,
            endpoint: $endpoint,
            apiKey: (string) ($this->setting('key', config('modules.ai.key')) ?: ''),
            model: $this->model(),
            maxTokens: (int) $this->setting('max_tokens', config('modules.ai.max_tokens', 1024)),
            temperature: (float) $this->setting('temperature', config('modules.ai.temperature', 0.3)),
            systemPrompt: $this->systemPrompt(),
            keepAlive: (string) ($this->setting('keep_alive', config('modules.ai.keep_alive', '10m')) ?: '10m'),
            timeout: (int) config('modules.ai.timeout', 300),
            connectTimeout: (int) config('modules.ai.connect_timeout', 10),
            contextTokens: $contextTokens ? (int) $contextTokens : null,
        );
    }

    /**
     * The configured provider key.
     *
     * Falls back to the legacy `mode` setting so installs that predate the
     * multi-provider rework keep working without an explicit migration step —
     * both of its values (`openai`, `ollama`) are still valid provider keys.
     */
    public function provider(): string
    {
        $provider = (string) ($this->setting('provider', config('modules.ai.provider')) ?: '');

        if ($provider === '') {
            $provider = (string) ($this->setting('mode', config('modules.ai.mode', 'ollama')) ?: 'ollama');
        }

        return in_array($provider, ProviderConfig::PROVIDERS, true)
            ? $provider
            : ProviderConfig::PROVIDER_OLLAMA;
    }

    /**
     * The single model used by every AI surface.
     */
    public function model(): string
    {
        if ($this->provider() === ProviderConfig::PROVIDER_OPENROUTER) {
            return OpenRouterProvider::MODEL;
        }

        return (string) ($this->setting('model', config('modules.ai.model')) ?: '');
    }

    /** Database, environment and direct factory callers cannot redirect OpenRouter. */
    private function canonicalOpenRouterConfig(ProviderConfig $config): ProviderConfig
    {
        return new ProviderConfig(
            provider: ProviderConfig::PROVIDER_OPENROUTER,
            endpoint: OpenRouterProvider::ENDPOINT,
            apiKey: $config->apiKey,
            model: OpenRouterProvider::MODEL,
            maxTokens: $config->maxTokens,
            temperature: $config->temperature,
            systemPrompt: $config->systemPrompt,
            keepAlive: $config->keepAlive,
            timeout: $config->timeout,
            connectTimeout: $config->connectTimeout,
            contextTokens: $config->contextTokens,
        );
    }

    /**
     * The house system prompt.
     *
     * A blank stored value falls back to the packaged default rather than to no
     * prompt at all: an admin who clears the field is asking for the default
     * back, and a model given no framing at all answers as a generic chatbot
     * with no idea it is inside a game server panel.
     */
    public function systemPrompt(): string
    {
        $prompt = trim((string) ($this->setting('system_prompt', '') ?: ''));

        return $prompt !== ''
            ? $prompt
            : trim((string) config('modules.ai.default_system_prompt', config('modules.ai.system_prompt', '')));
    }

    protected function setting(string $key, mixed $default = null): mixed
    {
        return Setting::get('settings::modules:ai:' . $key, $default);
    }
}
