<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application;

use Everest\Tests\TestCase;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Artisan;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\Email\EmailRedactor;
use Everest\Services\Mods\ModrinthService;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Http\Controllers\Api\Application\ModsController;
use Everest\Contracts\Repository\SettingsRepositoryInterface;
use Everest\Http\Controllers\Api\Application\PluginsController;
use Everest\Http\Controllers\Api\Application\IntelligenceController;
use Everest\Http\Requests\Api\Application\Mods\UpdateModsSettingsRequest;
use Everest\Http\Requests\Api\Application\Intelligence\UpdateIntelligenceSettingsRequest;

class SensitiveSettingsLoggingTest extends TestCase
{
    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testIntelligenceSettingsActivityRedactsSensitiveValues(): void
    {
        $repository = \Mockery::mock(SettingsRepositoryInterface::class);
        $repository->shouldReceive('set')->twice();
        $this->app->instance(SettingsRepositoryInterface::class, $repository);

        $controller = new IntelligenceController(
            \Mockery::mock(ProviderFactory::class),
            app(PiiRedactor::class),
            app(ToolBudget::class),
            app(AdminAuthorizer::class),
        );
        $request = \Mockery::mock(UpdateIntelligenceSettingsRequest::class);
        $request->shouldReceive('changesProviderConnection')->once()->andReturn(false);
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
            ->with('settings', \Mockery::on(function (array $payload) {
                return $payload['key'] === EmailRedactor::REDACTED_VALUE
                    && $payload['mode'] === 'openai';
            }))
            ->andReturnSelf();
        Activity::shouldReceive('description')->once()->andReturnSelf();
        Activity::shouldReceive('log')->once()->andReturnNull();

        $response = $controller->update($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }

    public function testDelegatedAdminCannotChangeProviderConnection(): void
    {
        $authorizer = \Mockery::mock(AdminAuthorizer::class);
        $authorizer->shouldReceive('isInteractiveOwner')->once()->andReturn(false);
        $controller = new IntelligenceController(
            \Mockery::mock(ProviderFactory::class),
            app(PiiRedactor::class),
            app(ToolBudget::class),
            $authorizer,
        );
        $request = \Mockery::mock(UpdateIntelligenceSettingsRequest::class);
        $request->shouldReceive('changesProviderConnection')->once()->andReturn(true);
        $request->shouldReceive('user')->once()->andReturn(\Mockery::mock(\Everest\Models\User::class));
        $request->shouldNotReceive('normalize');

        $this->expectException(\Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException::class);

        $controller->update($request);
    }

    public function testPluginsSettingsActivityLogsUpdate(): void
    {
        $repository = \Mockery::mock(SettingsRepositoryInterface::class);
        $repository->shouldReceive('set')->once();
        $this->app->instance(SettingsRepositoryInterface::class, $repository);
        Artisan::shouldReceive('call')->once()->with('config:clear');

        $controller = new PluginsController(
            \Mockery::mock(ModrinthService::class)
        );

        $request = \Mockery::mock(UpdateModsSettingsRequest::class);
        $request->shouldReceive('normalize')->once()->andReturn([
            'enabled' => true,
        ]);
        $request->shouldReceive('all')->once()->andReturn([
            'enabled' => true,
        ]);

        Activity::shouldReceive('event')->once()->with('admin:plugins:update')->andReturnSelf();
        Activity::shouldReceive('property')
            ->once()
            ->with('settings', \Mockery::on(function (array $payload) {
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
        $repository = \Mockery::mock(SettingsRepositoryInterface::class);
        $repository->shouldReceive('set')->once();
        $this->app->instance(SettingsRepositoryInterface::class, $repository);
        Artisan::shouldReceive('call')->once()->with('config:clear');

        $controller = new ModsController(
            \Mockery::mock(ModrinthService::class)
        );

        $request = \Mockery::mock(UpdateModsSettingsRequest::class);
        $request->shouldReceive('normalize')->once()->andReturn([
            'enabled' => true,
        ]);
        $request->shouldReceive('all')->once()->andReturn([
            'enabled' => true,
        ]);

        Activity::shouldReceive('event')->once()->with('admin:mods:update')->andReturnSelf();
        Activity::shouldReceive('property')
            ->once()
            ->with('settings', \Mockery::on(function (array $payload) {
                return $payload['enabled'] === true;
            }))
            ->andReturnSelf();
        Activity::shouldReceive('description')->once()->andReturnSelf();
        Activity::shouldReceive('log')->once()->andReturnNull();

        $response = $controller->update($request);

        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }
}
