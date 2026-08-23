<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application;

use Everest\Tests\TestCase;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Providers\OpenAiCompatibleProvider;
use Everest\Http\Controllers\Api\Application\IntelligenceController;
use Everest\Http\Requests\Api\Application\Intelligence\ProbeToolCallingRequest;

class IntelligenceToolProbeTest extends TestCase
{
    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testGenericCompatibleProviderReturnsTheLiveProbeResult(): void
    {
        $config = new ProviderConfig(
            provider: ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
            endpoint: 'http://127.0.0.1:8080/v1',
            model: 'tool-model',
        );

        $provider = \Mockery::mock(OpenAiCompatibleProvider::class);
        $provider->shouldReceive('probeToolCalling')
            ->once()
            ->with('tool-model')
            ->andReturn([
                'status' => 'supported',
                'supports_tools' => true,
                'model' => 'tool-model',
                'checked_at' => '2026-08-23T12:00:00+00:00',
            ]);

        $factory = \Mockery::mock(ProviderFactory::class);
        $factory->shouldReceive('config')->once()->andReturn($config);
        $factory->shouldReceive('make')->once()->with(120)->andReturn($provider);

        $response = $this->controller($factory)->probeToolCalling(
            \Mockery::mock(ProbeToolCallingRequest::class),
        );

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('supported', $response->getData(true)['status']);
        $this->assertTrue($response->getData(true)['supports_tools']);
    }

    public function testOtherProvidersCannotRunTheGenericCompatibleProbe(): void
    {
        $factory = \Mockery::mock(ProviderFactory::class);
        $factory->shouldReceive('config')->once()->andReturn(new ProviderConfig(
            provider: ProviderConfig::PROVIDER_OPENAI,
            endpoint: 'https://api.openai.com/v1',
            apiKey: 'sk-test',
            model: 'gpt-test',
        ));
        $factory->shouldNotReceive('make');

        $response = $this->controller($factory)->probeToolCalling(
            \Mockery::mock(ProbeToolCallingRequest::class),
        );

        $this->assertSame(422, $response->getStatusCode());
        $this->assertSame('error', $response->getData(true)['status']);
    }

    private function controller(ProviderFactory $factory): IntelligenceController
    {
        return new IntelligenceController(
            $factory,
            \Mockery::mock(PiiRedactor::class),
            \Mockery::mock(ToolBudget::class),
        );
    }
}
