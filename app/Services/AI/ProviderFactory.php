<?php

namespace Everest\Services\AI;

use Everest\Models\Setting;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Providers\OllamaProvider;
use Everest\Services\AI\Providers\AnthropicProvider;
use Everest\Exceptions\Service\AI\AIServiceException;
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
     * The strong model, used for the agent loop where tool-call reliability
     * matters more than cost.
     */
    public const TASK_AGENT = 'agent';

    /**
     * The cheap model, used for log triage, conversation titles, and anything
     * else that is a single short completion.
     */
    public const TASK_FAST = 'fast';

    public const TASKS = [self::TASK_AGENT, self::TASK_FAST];

    /**
     * Sensible endpoint per provider when the admin has not set one.
     */
    public const DEFAULT_ENDPOINTS = [
        ProviderConfig::PROVIDER_ANTHROPIC => 'https://api.anthropic.com/v1',
        ProviderConfig::PROVIDER_OPENAI => 'https://api.openai.com/v1',
        ProviderConfig::PROVIDER_OLLAMA => 'http://127.0.0.1:11434/v1',
        ProviderConfig::PROVIDER_OPENAI_COMPATIBLE => '',
    ];

    /**
     * Build the provider for a task class, falling back to the default model
     * when no task-specific model has been configured.
     *
     * @throws AIServiceException
     */
    public function make(?string $task = null): AiProvider
    {
        return $this->fromConfig($this->config($task));
    }

    /**
     * @throws AIServiceException
     */
    public function fromConfig(ProviderConfig $config): AiProvider
    {
        return match ($config->provider) {
            ProviderConfig::PROVIDER_ANTHROPIC => new AnthropicProvider($config),
            ProviderConfig::PROVIDER_OLLAMA => new OllamaProvider($config),
            ProviderConfig::PROVIDER_OPENAI,
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE => new OpenAiCompatibleProvider($config),
            default => throw new AIServiceException('Unsupported AI provider: ' . $config->provider),
        };
    }

    /**
     * Resolve the effective settings for a task class.
     */
    public function config(?string $task = null): ProviderConfig
    {
        $provider = $this->provider();

        $endpoint = (string) $this->setting('endpoint', config('modules.ai.endpoint'));
        if ($endpoint === '') {
            $endpoint = self::DEFAULT_ENDPOINTS[$provider] ?? '';
        }

        $contextTokens = $this->setting('context_tokens', config('modules.ai.context_tokens'));

        return new ProviderConfig(
            provider: $provider,
            endpoint: $endpoint,
            apiKey: (string) ($this->setting('key', config('modules.ai.key')) ?: ''),
            model: $this->model($task),
            maxTokens: (int) $this->setting('max_tokens', config('modules.ai.max_tokens', 1024)),
            temperature: (float) $this->setting('temperature', config('modules.ai.temperature', 0.3)),
            systemPrompt: (string) ($this->setting('system_prompt', config('modules.ai.system_prompt')) ?: ''),
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
     * The model for a task class. An unset task model means "use the default",
     * so an operator running a single model does not have to fill in three
     * identical fields.
     */
    public function model(?string $task = null): string
    {
        $default = (string) ($this->setting('model', config('modules.ai.model')) ?: '');

        if ($task === null || !in_array($task, self::TASKS, true)) {
            return $default;
        }

        $specific = (string) ($this->setting('models:' . $task, config('modules.ai.models.' . $task)) ?: '');

        return $specific !== '' ? $specific : $default;
    }

    protected function setting(string $key, mixed $default = null): mixed
    {
        return Setting::get('settings::modules:ai:' . $key, $default);
    }
}
