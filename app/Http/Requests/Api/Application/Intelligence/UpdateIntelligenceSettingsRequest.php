<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateIntelligenceSettingsRequest extends ApplicationApiRequest
{
    private ?string $storedProvider = null;

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
            'agent.admin_enabled' => 'nullable|bool',
            'agent.reasoning' => 'nullable|bool',
            // A turn is bounded three ways because any one of them alone can be
            // escaped: a model can loop cheaply, stall expensively, or both. The
            // fourth bounds a single tool call, which the other three cannot see
            // — the wall clock is only read between steps, so a step that never
            // returns runs past all of them.
            //
            // Every bound below matches the floor its runtime reader clamps to.
            // They did not: 15 was accepted here and silently became 30 in
            // `AgentRunner::maxWallSeconds()`, so the panel showed a saved value
            // the agent was not using. Refusing the value is the honest half of
            // that pair — a clamp the operator cannot see is worse than an error
            // they can.
            'agent.max_steps' => 'nullable|integer|min:1|max:50',
            'agent.max_wall_seconds' => sprintf(
                'nullable|integer|min:%d|max:%d',
                AgentRunner::MIN_WALL_SECONDS,
                AgentRunner::MAX_WALL_SECONDS,
            ),
            'agent.max_tool_seconds' => 'nullable|integer|min:5|max:900',
            'agent.tool_result_bytes' => 'nullable|integer|min:1024|max:131072',
            'agent.max_repairs' => 'nullable|integer|min:0|max:5',
            'agent.max_tools' => 'nullable|integer|min:4|max:64',
            'agent.max_batch_calls' => 'nullable|integer|min:2|max:100',
            'agent.allow_destructive_batches' => 'nullable|boolean',

            // The category list is validated against the redactor's own constants
            // rather than a literal, so adding a category in one place cannot
            // leave it silently unsettable here.
            'privacy.enabled' => 'nullable|bool',
            'privacy.categories' => 'nullable|array',
            'privacy.categories.*' => 'string|in:' . implode(',', PiiRedactor::KINDS),

            // Two sentinels, both meaning "off" rather than "one": zero queue
            // depth refuses every turn that cannot have a slot immediately, and
            // zero per-user means no per-user cap at all. The runtime readers
            // agree, and the admin copy says so.
            'concurrency.slots' => 'nullable|integer|min:1|max:64',
            'concurrency.queue_depth' => 'nullable|integer|min:0|max:500',
            'concurrency.max_wait_seconds' => 'nullable|integer|min:5|max:600',
            'concurrency.per_user' => 'nullable|integer|min:0|max:16',

            'budget.enforce' => 'nullable|bool',
            // Zero is an allowance of zero once enforcement is on, not
            // "unlimited" — see `AiBudgetService::assertWithinBudget()`. The
            // way to run unenforced is to leave `budget.enforce` off.
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

        // Settings values are strings. An array reaching Setting::set stringifies
        // to "Array" without raising anything, so the category list is encoded
        // here — the same JSON-blob treatment the tool policy already gets.
        if (is_array($normalized['privacy:categories'] ?? null)) {
            $normalized['privacy:categories'] = json_encode(array_values($normalized['privacy:categories']));
        }

        return $this->resetProviderScopedSettings($normalized);
    }

    /**
     * Blank the settings that belong to one provider when a different one is
     * being saved.
     *
     * The endpoint and API key occupy a single slot shared by every provider
     * rather than one slot each, so without this a switch silently carries the
     * previous provider's values across — the Anthropic driver left pointing at
     * a LAN Ollama address, or an OpenAI key sent to Anthropic. Values supplied
     * in the same request are kept: those were entered for the new provider and
     * have already been validated against it.
     *
     * @param array<string, mixed> $normalized
     *
     * @return array<string, mixed>
     */
    private function resetProviderScopedSettings(array $normalized): array
    {
        if (!isset($normalized['provider']) || $normalized['provider'] === $this->storedProvider()) {
            return $normalized;
        }

        foreach (['endpoint', 'key'] as $scoped) {
            // Blank rather than the new provider's default: ProviderFactory
            // already substitutes one, so an empty value keeps picking up
            // whatever that default later becomes.
            $normalized[$scoped] ??= '';
        }

        return $normalized;
    }

    public function permission(): string
    {
        return AdminRole::AI_UPDATE;
    }

    /**
     * The provider currently in effect, read once per request — `rules()` and
     * `normalize()` both need it and it costs a settings lookup.
     */
    private function storedProvider(): string
    {
        return $this->storedProvider ??= app(ProviderFactory::class)->provider();
    }

    /**
     * Hosted providers must be reached over TLS; self-hosted ones are usually
     * a plain-HTTP address on a private network, so http:// stays legal there.
     *
     * The tier is judged against the provider *being saved*, falling back to
     * the stored one — a partial save that touches the endpoint but not the
     * provider must not be measured against an empty string, which would
     * demand HTTPS of a perfectly valid local Ollama address.
     */
    private function endpointRule(): callable
    {
        $provider = (string) $this->input('provider', '') ?: $this->storedProvider();

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
