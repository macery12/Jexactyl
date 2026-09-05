<?php

namespace Everest\Tests\Unit\Console\Commands\AI;

use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Everest\Console\Commands\AI\WarmAiModelCommand;
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;

class WarmAiModelCommandTest extends TestCase
{
    use RefreshDatabase;

    public function testHostedProviderIsNotEligibleEvenWhenWarmupWasPreviouslyEnabled(): void
    {
        Setting::set('settings::modules:ai:enabled', 'true');
        Setting::set('settings::modules:ai:warm', 'true');
        Setting::set('settings::modules:ai:provider', ProviderConfig::PROVIDER_ANTHROPIC);

        $factory = app(ProviderFactory::class);

        $this->assertFalse(WarmAiModelCommand::shouldRun($factory));
        $this->assertFalse($this->scheduledWarmup()->filtersPass($this->app));
        $this->artisan('p:ai:warm')
            ->expectsOutputToContain('AI warm-up skipped')
            ->assertSuccessful();
    }

    public function testEnabledOllamaWarmupIsEligibleForTheScheduler(): void
    {
        Setting::set('settings::modules:ai:enabled', 'true');
        Setting::set('settings::modules:ai:warm', 'true');
        Setting::set('settings::modules:ai:provider', ProviderConfig::PROVIDER_OLLAMA);

        $this->assertTrue(WarmAiModelCommand::shouldRun(app(ProviderFactory::class)));
        $this->assertTrue($this->scheduledWarmup()->filtersPass($this->app));
    }

    private function scheduledWarmup(): \Illuminate\Console\Scheduling\Event
    {
        $event = collect(app(ConsoleKernel::class)->resolveConsoleSchedule()->events())
            ->first(fn ($event): bool => str_contains((string) $event->command, 'p:ai:warm'));

        $this->assertNotNull($event, 'The Ollama warm-up command should remain registered with the scheduler.');

        return $event;
    }
}
