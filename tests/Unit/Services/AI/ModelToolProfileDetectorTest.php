<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Data\ProviderCapabilities;
use Everest\Services\AI\Agent\ModelToolProfileDetector;
use Everest\Services\AI\Providers\OpenAiCompatibleProvider;

class ModelToolProfileDetectorTest extends TestCase
{
    private const SETTING = 'settings::modules:ai:agent:max_tools';

    public function testAWindowsGgufPathSeparatesParametersFromQuantization(): void
    {
        $detected = $this->detector()->detect(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            'D:\\llamacpp\\Models\\Qwen3-1.7B-Q8_0.gguf',
            $this->localCapabilities(),
        );

        $this->assertSame(ToolBudget::PROFILE_TINY, $detected['profile']);
        $this->assertSame(ModelToolProfileDetector::SOURCE_MODEL_NAME, $detected['source']);
        $this->assertSame(1_700_000_000, $detected['parameter_count']);
        $this->assertStringContainsString('1.7B', $detected['reason']);
    }

    public function testParameterMetadataWinsOverAConflictingFilename(): void
    {
        $detected = $this->detector()->detect(
            ProviderConfig::PROVIDER_OLLAMA,
            'misleading-27B-Q4_K_M.gguf',
            $this->localCapabilities(parameterCount: 2_000_000_000),
        );

        $this->assertSame(ToolBudget::PROFILE_TINY, $detected['profile']);
        $this->assertSame(ModelToolProfileDetector::SOURCE_METADATA, $detected['source']);
        $this->assertSame(ModelToolProfileDetector::CONFIDENCE_HIGH, $detected['confidence']);
        $this->assertSame(2_000_000_000, $detected['parameter_count']);
    }

    public function testLocalParameterTiersMatchTheFourHardwareOptions(): void
    {
        foreach ([
            'qwen-2B.gguf' => ToolBudget::PROFILE_TINY,
            'qwen-4B.gguf' => ToolBudget::PROFILE_SMALL,
            'qwen-9B.gguf' => ToolBudget::PROFILE_MEDIUM,
            'qwen-27B.gguf' => ToolBudget::PROFILE_LARGE,
        ] as $model => $profile) {
            $this->assertSame(
                $profile,
                $this->detector()->detect(
                    ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
                    $model,
                    $this->localCapabilities(),
                )['profile'],
                $model,
            );
        }
    }

    public function testMixtureNamesUseTheConservativeTotalParameterCount(): void
    {
        $detected = $this->detector()->detect(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            'Mixtral-8x7B-Instruct-Q5_K_M.gguf',
            $this->localCapabilities(),
        );

        $this->assertSame(ToolBudget::PROFILE_LARGE, $detected['profile']);
        $this->assertSame(56_000_000_000, $detected['parameter_count']);
    }

    public function testExplicitActiveMixtureParametersUseTheConservativeActiveCount(): void
    {
        $detected = $this->detector()->detect(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            'Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf',
            $this->localCapabilities(),
        );

        $this->assertSame(ToolBudget::PROFILE_TINY, $detected['profile']);
        $this->assertSame(3_000_000_000, $detected['parameter_count']);
        $this->assertStringContainsString('active parameters', $detected['reason']);
    }

    public function testEveryHostedOpenAiAndAnthropicModelReceivesTheFullProfile(): void
    {
        $hosted = new ProviderCapabilities(supportsTools: true, selfHosted: false);

        $cases = [
            [ProviderConfig::PROVIDER_OPENAI, 'gpt-5-nano'],
            [ProviderConfig::PROVIDER_OPENAI, 'gpt-5-mini'],
            [ProviderConfig::PROVIDER_OPENAI, 'unrecognized-hosted-model'],
            [ProviderConfig::PROVIDER_ANTHROPIC, 'claude-haiku-4-5'],
            [ProviderConfig::PROVIDER_ANTHROPIC, 'claude-sonnet-5'],
            [ProviderConfig::PROVIDER_ANTHROPIC, 'unrecognized-hosted-model'],
            [ProviderConfig::PROVIDER_OPENROUTER, 'openrouter/free'],
        ];

        foreach ($cases as [$provider, $model]) {
            $detected = $this->detector()->detect($provider, $model, $hosted);

            $this->assertSame(ToolBudget::PROFILE_FRONTIER, $detected['profile'], $model);
            $this->assertSame(ModelToolProfileDetector::SOURCE_PROVIDER_FAMILY, $detected['source'], $model);
            $this->assertSame(ModelToolProfileDetector::CONFIDENCE_HIGH, $detected['confidence'], $model);
        }
    }

    public function testAnUnknownLocalNameUsesTheConservativeSmallFallback(): void
    {
        $detected = $this->detector()->detect(
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            'custom-agent.gguf',
            $this->localCapabilities(),
        );

        $this->assertSame(ToolBudget::PROFILE_SMALL, $detected['profile']);
        $this->assertSame(ModelToolProfileDetector::SOURCE_FALLBACK, $detected['source']);
        $this->assertSame(ModelToolProfileDetector::CONFIDENCE_LOW, $detected['confidence']);
    }

    public function testAFailedLocalCapabilityProbeStillUsesTheLocalModelName(): void
    {
        $detected = $this->detector()->detect(
            ProviderConfig::PROVIDER_OLLAMA,
            'qwen3:1.7b',
            ProviderCapabilities::unknown('endpoint unavailable'),
        );

        $this->assertSame(ToolBudget::PROFILE_TINY, $detected['profile']);
        $this->assertSame(ModelToolProfileDetector::SOURCE_MODEL_NAME, $detected['source']);
        $this->assertSame(1_700_000_000, $detected['parameter_count']);
    }

    public function testAnEmptyStoredAutoValueRemainsNullToTheApiAndUsesNameDetection(): void
    {
        $missing = new \stdClass();
        $original = Setting::get(self::SETTING, $missing);

        try {
            // This is what a saved null becomes after the next process boot.
            Setting::set(self::SETTING, '');
            config()->set('modules.ai.agent.max_tools', '');

            $provider = new OpenAiCompatibleProvider(new ProviderConfig(
                provider: ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
                endpoint: 'http://127.0.0.1:8080/v1',
                model: 'Qwen3-1.7B-Q8_0.gguf',
            ));

            $factory = new class ($provider) extends ProviderFactory {
                public function __construct(private AiProvider $provider)
                {
                }

                public function provider(): string
                {
                    return ProviderConfig::PROVIDER_OPENAI_COMPATIBLE;
                }

                public function model(): string
                {
                    return 'Qwen3-1.7B-Q8_0.gguf';
                }

                public function make(?int $timeoutSeconds = null): AiProvider
                {
                    return $this->provider;
                }
            };

            $budget = new ToolBudget($factory, $this->detector(), new \Everest\Services\AI\Agent\ToolBudgetCalibration());

            $this->assertNull($budget->manualSchemas());
            $this->assertSame(ToolBudget::PROFILE_TINY, $budget->profile());
            $this->assertSame(6, $budget->schemas());
            $this->assertSame(8, $budget->totalSchemas());
        } finally {
            if ($original === $missing) {
                Setting::forget(self::SETTING);
            } else {
                Setting::set(self::SETTING, $original);
            }
        }
    }

    private function detector(): ModelToolProfileDetector
    {
        return new ModelToolProfileDetector();
    }

    private function localCapabilities(?int $parameterCount = null): ProviderCapabilities
    {
        return new ProviderCapabilities(
            supportsTools: true,
            selfHosted: true,
            modelParameterCount: $parameterCount,
        );
    }
}
