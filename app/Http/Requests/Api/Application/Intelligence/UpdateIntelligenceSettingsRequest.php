<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateIntelligenceSettingsRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'enabled' => 'nullable|bool',
            'key' => 'nullable',
            'provider' => 'nullable|string|in:' . implode(',', ProviderConfig::PROVIDERS),

            // Superseded by `provider`, kept writable so an install configured
            // before the multi-provider rework can still be edited.
            'mode' => 'nullable|string|in:openai,ollama',

            'models.agent' => 'nullable|string|max:100',
            'models.fast' => 'nullable|string|max:100',

            'max_tokens' => 'nullable|integer|min:50|max:32000',
            'temperature' => 'nullable|numeric|min:0|max:1',

            // A hard ceiling on the context window. Only meaningful for
            // self-hosted providers, where context is paid for in VRAM.
            'context_tokens' => 'nullable|integer|min:2048|max:1000000',

            'keep_alive' => 'nullable|string|in:5m,10m,30m,1h,4h,24h,-1',
            'warm' => 'nullable|bool',
            'system_prompt' => 'nullable|string|min:10|max:1000',
            'feature_server_assistant' => 'nullable|bool',
            'feature_crash_analysis' => 'nullable|bool',

            'agent.enabled' => 'nullable|bool',
            // A turn is bounded three ways because any one of them alone can be
            // escaped: a model can loop cheaply, stall expensively, or both.
            'agent.max_steps' => 'nullable|integer|min:1|max:50',
            'agent.max_wall_seconds' => 'nullable|integer|min:15|max:900',
            'agent.tool_result_bytes' => 'nullable|integer|min:1024|max:131072',
            'agent.max_repairs' => 'nullable|integer|min:0|max:5',
            'agent.max_tools' => 'nullable|integer|min:4|max:64',

            'concurrency.slots' => 'nullable|integer|min:1|max:64',
            'concurrency.queue_depth' => 'nullable|integer|min:0|max:500',
            'concurrency.max_wait_seconds' => 'nullable|integer|min:5|max:600',
            'concurrency.per_user' => 'nullable|integer|min:0|max:16',

            'budget.enforce' => 'nullable|bool',
            'budget.monthly_tokens' => 'nullable|integer|min:0',

            'endpoint' => ['nullable', $this->endpointRule()],
            'model' => 'nullable|string|max:100',
        ];
    }

    /**
     * Flatten the payload into the colon-delimited keys settings are stored
     * under.
     *
     * Validation addresses nested fields in dot notation, but `Request::only()`
     * would hand those back as nested arrays and the caller writes one setting
     * per key — `models` would be stored as an array instead of
     * `models:agent` and `models:fast`.
     */
    public function normalize(?array $only = null): array
    {
        $normalized = [];

        foreach ($only ?? array_keys($this->rules()) as $key) {
            // Absent means untouched. Without this a partial save would blank
            // every field the form did not send.
            if (!$this->has($key)) {
                continue;
            }

            $normalized[str_replace('.', ':', $key)] = $this->input($key);
        }

        return $normalized;
    }

    public function permission(): string
    {
        return AdminRole::AI_UPDATE;
    }

    /**
     * Hosted providers must be reached over TLS; self-hosted ones are usually
     * a plain-HTTP address on a private network, so http:// stays legal there.
     */
    private function endpointRule(): callable
    {
        $provider = (string) $this->input('provider', $this->input('mode', ''));

        return function ($attribute, $value, $fail) use ($provider) {
            if ($value === null || $value === '') {
                return;
            }

            if (!filter_var($value, FILTER_VALIDATE_URL)) {
                $fail('The endpoint must be a valid URL.');

                return;
            }

            if (!str_starts_with($value, 'http://') && !str_starts_with($value, 'https://')) {
                $fail('The endpoint must start with http:// or https://.');

                return;
            }

            if (!in_array($provider, ProviderConfig::SELF_HOSTED, true) && !str_starts_with($value, 'https://')) {
                $fail('A hosted provider endpoint must use HTTPS.');

                return;
            }

            // Credentials in the authority are a URL-confusion vector: the host
            // a human reads is not the host the client connects to.
            $parsed = parse_url($value);
            if (isset($parsed['user']) || str_contains($value, '@')) {
                $fail('The endpoint URL contains invalid characters.');
            }
        };
    }
}
