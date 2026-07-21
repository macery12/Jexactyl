<?php

namespace Everest\Console\Commands\AI;

use Everest\Models\Setting;
use Illuminate\Console\Command;
use Everest\Services\AI\OpenAIService;

class WarmAiModelCommand extends Command
{
    protected $signature = 'p:ai:warm';

    protected $description = 'Keep the configured Ollama model loaded in memory so users never hit a cold start.';

    public function handle(OpenAIService $service): int
    {
        $enabled = filter_var(
            Setting::get('settings::modules:ai:enabled', config('modules.ai.enabled', false)),
            FILTER_VALIDATE_BOOLEAN
        );
        $warm = filter_var(
            Setting::get('settings::modules:ai:warm', config('modules.ai.warm', false)),
            FILTER_VALIDATE_BOOLEAN
        );
        $mode = Setting::get('settings::modules:ai:mode', config('modules.ai.mode', 'openai'));

        if (!$enabled || !$warm || $mode !== 'ollama') {
            $this->line('AI warm-up skipped (disabled, warm-up off, or provider is not Ollama).');

            return Command::SUCCESS;
        }

        if ($service->warm()) {
            $this->info('Ollama model warmed successfully.');

            return Command::SUCCESS;
        }

        $this->warn('Ollama model warm-up failed — see the application log.');

        return Command::FAILURE;
    }
}
