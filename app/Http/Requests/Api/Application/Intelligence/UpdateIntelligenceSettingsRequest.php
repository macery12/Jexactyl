<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateIntelligenceSettingsRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        $mode = $this->input('mode', 'openai');

        return [
            'enabled' => 'nullable|bool',
            'key' => 'nullable',
            'mode' => 'nullable|string|in:openai,ollama',
            'max_tokens' => 'nullable|integer|min:50|max:4000',
            'temperature' => 'nullable|numeric|min:0|max:1',
            // How long Ollama keeps the model in memory after a request.
            // '-1' = never unload (no cold starts, permanent VRAM use).
            'keep_alive' => 'nullable|string|in:5m,10m,30m,1h,4h,24h,-1',
            // Scheduled warm-up ping that keeps the Ollama model loaded.
            'warm' => 'nullable|bool',
            'system_prompt' => 'nullable|string|min:10|max:1000',
            'feature_server_assistant' => 'nullable|bool',
            'feature_crash_analysis' => 'nullable|bool',
            'endpoint' => [
                'nullable',
                function ($attribute, $value, $fail) use ($mode) {
                    // Only validate if value is provided (not null or empty)
                    if ($value !== null && $value !== '') {
                        // Validate it's a URL
                        if (!filter_var($value, FILTER_VALIDATE_URL)) {
                            $fail('The endpoint must be a valid URL.');

                            return;
                        }

                        // For OpenAI mode, require HTTPS
                        // For Ollama mode, allow both HTTP (for local) and HTTPS
                        if ($mode === 'openai' && !str_starts_with($value, 'https://')) {
                            $fail('The endpoint must use HTTPS for OpenAI mode.');

                            return;
                        }

                        if (!str_starts_with($value, 'http://') && !str_starts_with($value, 'https://')) {
                            $fail('The endpoint must start with http:// or https://.');

                            return;
                        }

                        $parsed = parse_url($value);
                        // Ensure no @ in the authority part (prevents URL confusion attacks)
                        if (isset($parsed['user']) || strpos($value, '@') !== false) {
                            $fail('The endpoint URL contains invalid characters.');
                        }
                    }
                },
            ],
            'model' => [
                'nullable',
                function ($attribute, $value, $fail) {
                    // Only validate if value is provided (not null or empty)
                    if ($value !== null && $value !== '') {
                        if (!is_string($value)) {
                            $fail('The model must be a string.');

                            return;
                        }
                        if (strlen($value) > 100) {
                            $fail('The model must be between 1 and 100 characters.');
                        }
                    }
                },
            ],
        ];
    }

    public function permission(): string
    {
        return AdminRole::AI_UPDATE;
    }
}
