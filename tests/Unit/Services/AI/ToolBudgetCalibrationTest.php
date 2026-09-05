<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Agent\ToolBudgetCalibration;
use Everest\Services\AI\Agent\ModelToolProfileDetector;

class ToolBudgetCalibrationTest extends TestCase
{
    protected function tearDown(): void
    {
        Setting::forget(ToolBudgetCalibration::SETTING);
        Setting::forget('settings::modules:ai:agent:max_tools');

        parent::tearDown();
    }

    public function testRecommendationStopsAtTheHighestRepeatedPerfectLevel(): void
    {
        $calibration = new ToolBudgetCalibration();
        $recommendation = $calibration->recommend($this->benchmark([
            'four_tool_selection' => [3, 3],
            'eight_tool_selection' => [3, 3],
            'twelve_tool_selection' => [3, 3],
            'twenty_tool_selection' => [2, 3],
        ]));

        $this->assertSame(12, $recommendation['schemas']);
        $this->assertTrue($recommendation['reliable']);
        $this->assertSame(3, $recommendation['minimum_attempts']);
    }

    public function testOneRunRecommendationRemainsProvisional(): void
    {
        $recommendation = (new ToolBudgetCalibration())->recommend($this->benchmark([
            'four_tool_selection' => [1, 1],
            'eight_tool_selection' => [1, 1],
            'twelve_tool_selection' => [1, 1],
            'twenty_tool_selection' => [1, 1],
        ]));

        $this->assertSame(20, $recommendation['schemas']);
        $this->assertFalse($recommendation['reliable']);
    }

    public function testIncompleteToolSelectionAttemptsCannotCreateACalibration(): void
    {
        $benchmark = $this->benchmark([
            'four_tool_selection' => [3, 3],
            'eight_tool_selection' => [3, 3],
            'twelve_tool_selection' => [3, 3],
            'twenty_tool_selection' => [3, 3],
        ]);
        $benchmark['cases'][2]['completed_attempts'] = 2;
        $benchmark['cases'][2]['incomplete_attempts'] = 1;

        $recommendation = (new ToolBudgetCalibration())->recommend($benchmark);

        $this->assertFalse($recommendation['reliable']);
        $this->assertSame(8, $recommendation['schemas']);
        $this->assertStringContainsString('incomplete', $recommendation['reason']);
    }

    public function testSavedCalibrationIsExactToProviderEndpointModelAndReasoningMode(): void
    {
        config()->set('modules.ai.agent.reasoning', true);
        $calibration = new ToolBudgetCalibration();
        $config = $this->config('qwen/tool-model', 'http://127.0.0.1:11343/v1/');
        $recommendation = $calibration->recommend($this->benchmark([
            'four_tool_selection' => [3, 3],
            'eight_tool_selection' => [3, 3],
            'twelve_tool_selection' => [3, 3],
            'twenty_tool_selection' => [2, 3],
        ]));

        $calibration->save($config, $recommendation);

        $this->assertSame(12, $calibration->find($this->config('qwen/tool-model', 'http://127.0.0.1:11343/v1'))['schemas']);
        $this->assertNull($calibration->find($this->config('another-model', 'http://127.0.0.1:11343/v1')));
        config()->set('modules.ai.agent.reasoning', false);
        $this->assertNull($calibration->find($config));
    }

    public function testToolBudgetUsesARepeatedCalibrationBeforeNameDetection(): void
    {
        config()->set('modules.ai.agent.reasoning', true);
        Setting::forget('settings::modules:ai:agent:max_tools');
        $calibration = new ToolBudgetCalibration();
        $config = $this->config('Qwen3.6-35B-A3B-Q4_K_XL.gguf');
        $calibration->save($config, $calibration->recommend($this->benchmark([
            'four_tool_selection' => [3, 3],
            'eight_tool_selection' => [3, 3],
            'twelve_tool_selection' => [3, 3],
            'twenty_tool_selection' => [2, 3],
        ])));

        $factory = \Mockery::mock(ProviderFactory::class);
        $factory->shouldReceive('config')->once()->andReturn($config);
        $budget = new ToolBudget($factory, new ModelToolProfileDetector(), $calibration);

        $this->assertSame(ToolBudget::PROFILE_CALIBRATED, $budget->profile());
        $this->assertSame(12, $budget->schemas());
        $this->assertSame(16, $budget->totalSchemas());
        $this->assertSame('calibrated', $budget->source());
    }

    /** @param array<string, array{0: int, 1: int}> $levels */
    private function benchmark(array $levels): array
    {
        return ['cases' => array_map(
            static fn (string $id, array $score): array => [
                'id' => $id,
                'passed_attempts' => $score[0],
                'total_attempts' => $score[1],
            ],
            array_keys($levels),
            array_values($levels),
        )];
    }

    private function config(
        string $model,
        string $endpoint = 'http://127.0.0.1:11343/v1',
    ): ProviderConfig {
        return new ProviderConfig(
            provider: ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            endpoint: $endpoint,
            model: $model,
        );
    }
}
