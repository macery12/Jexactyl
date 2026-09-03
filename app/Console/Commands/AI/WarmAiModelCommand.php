<?php

namespace Everest\Console\Commands\AI;

use Everest\Models\Setting;
use Illuminate\Console\Command;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Providers\OllamaProvider;

class WarmAiModelCommand extends Command
{
    protected $signature = 'p:ai:warm';

    protected $description = 'Keep the configured Ollama model loaded in memory so users never hit a cold start.';

    /**
     * Whether an Ollama warm-up is useful for the current configuration.
     *
     * The scheduler uses the same predicate so hosted providers do not launch
     * a five-minute no-op process. The command repeats the check because it can
     * also be invoked manually, and settings may change after a schedule tick
     * has decided that the event is due.
     */
    public static function shouldRun(ProviderFactory $factory): bool
    {
        $enabled = filter_var(
            Setting::get('settings::modules:ai:enabled', config('modules.ai.enabled', false)),
            FILTER_VALIDATE_BOOLEAN
        );
        $warm = filter_var(
            Setting::get('settings::modules:ai:warm', config('modules.ai.warm', false)),
            FILTER_VALIDATE_BOOLEAN
        );
        $provider = $factory->provider();

        return $enabled && $warm && $provider === ProviderConfig::PROVIDER_OLLAMA;
    }

    public function handle(ProviderFactory $factory): int
    {
        if (!self::shouldRun($factory)) {
            $this->line('AI warm-up skipped (disabled, warm-up off, or provider is not Ollama).');

            return Command::SUCCESS;
        }

        $driver = $factory->make();

        if ($driver instanceof OllamaProvider && $driver->warm()) {
            $this->info('Ollama model warmed successfully.');

            return Command::SUCCESS;
        }

        $this->warn('Ollama model warm-up failed — see the application log.');

        return Command::FAILURE;
    }
}
