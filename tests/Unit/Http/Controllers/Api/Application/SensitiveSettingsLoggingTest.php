<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application;

use Mockery;
use Everest\Tests\TestCase;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Artisan;
use Everest\Facades\Activity;
use Everest\Services\AI\OpenAIService;
use Everest\Services\Mods\ModrinthService;
use Everest\Services\Email\EmailRedactor;
use Everest\Contracts\Repository\SettingsRepositoryInterface;
use Everest\Http\Controllers\Api\Application\ModsController;
use Everest\Http\Controllers\Api\Application\PluginsController;
use Everest\Http\Controllers\Api\Application\IntelligenceController;
use Everest\Http\Requests\Api\Application\Intelligence\UpdateIntelligenceSettingsRequest;
use Everest\Http\Requests\Api\Application\Mods\UpdateModsSettingsRequest;

class SensitiveSettingsLoggingTest extends TestCase
{
    protected function tearDown(): void
    {
        Mockery::close();

        parent::tearDown();
    }

    public function testIntelligenceSettingsActivityRedactsSensitiveValues(): void
    {
        $repository = Mockery::mock(SettingsRepositoryInterface::class);
        $repository->shouldReceive('set')->twice();
        $this->app->instance(SettingsRepositoryInterface::class, $repository);

        $controller = new IntelligenceController(Mockery::mock(OpenAIService::class));
        $request = Mockery::mock(UpdateIntelligenceSettingsRequest::class);
        $request->shouldReceive('normalize')->once()->andReturn([
            'key' => 'super-secret-ai-key',
            'mode' => 'openai',
        ]);
        $request->shouldReceive('all')->once()->andReturn([
            'key' => 'super-secret-ai-key',
            'mode' => 'openai',
        ]);

        Activity::shouldReceive('event')->once()->with('admin:ai:update')->andReturnSelf();
        Activity::shouldReceive('property')
            ->once()
            ->with('settings', Mockery::on(function (array $payload) {
                return $payload['key'] === EmailRedactor::REDACTED_VALUE
                    && $payload['mode'] === 'openai';
            }))
            ->andReturnSelf();
        Activity::shouldReceive('description')->once()->andReturnSelf();
        Activity::shouldReceive('log')->once()->andReturnNull();

        $response = $controller->update($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }

    public function testPluginsSettingsActivityLogsUpdate(): void
    {
        $repository = Mockery::mock(SettingsRepositoryInterface::class);
        $repository->shouldReceive('set')->once();
        $this->app->instance(SettingsRepositoryInterface::class, $repository);
        Artisan::shouldReceive('call')->once()->with('config:clear');

        $controller = new PluginsController(
            Mockery::mock(ModrinthService::class)
        );

        $request = Mockery::mock(UpdateModsSettingsRequest::class);
        $request->shouldReceive('normalize')->once()->andReturn([
            'enabled' => true,
        ]);
        $request->shouldReceive('all')->once()->andReturn([
            'enabled' => true,
        ]);

        Activity::shouldReceive('event')->once()->with('admin:plugins:update')->andReturnSelf();
        Activity::shouldReceive('property')
            ->once()
            ->with('settings', Mockery::on(function (array $payload) {
                return $payload['enabled'] === true;
            }))
            ->andReturnSelf();
        Activity::shouldReceive('description')->once()->andReturnSelf();
        Activity::shouldReceive('log')->once()->andReturnNull();

        $response = $controller->update($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }

    public function testModsSettingsActivityLogsUpdate(): void
    {
        $repository = Mockery::mock(SettingsRepositoryInterface::class);
        $repository->shouldReceive('set')->once();
        $this->app->instance(SettingsRepositoryInterface::class, $repository);
        Artisan::shouldReceive('call')->once()->with('config:clear');

        $controller = new ModsController(
            Mockery::mock(ModrinthService::class)
        );

        $request = Mockery::mock(UpdateModsSettingsRequest::class);
        $request->shouldReceive('normalize')->once()->andReturn([
            'enabled' => true,
        ]);
        $request->shouldReceive('all')->once()->andReturn([
            'enabled' => true,
        ]);

        Activity::shouldReceive('event')->once()->with('admin:mods:update')->andReturnSelf();
        Activity::shouldReceive('property')
            ->once()
            ->with('settings', Mockery::on(function (array $payload) {
                return $payload['enabled'] === true;
            }))
            ->andReturnSelf();
        Activity::shouldReceive('description')->once()->andReturnSelf();
        Activity::shouldReceive('log')->once()->andReturnNull();

        $response = $controller->update($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }
}
