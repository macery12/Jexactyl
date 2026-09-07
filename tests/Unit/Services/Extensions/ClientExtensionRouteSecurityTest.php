<?php

namespace Everest\Tests\Unit\Services\Extensions;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Routing\RouteCollection;
use Everest\Services\Extensions\ExtensionRuntimeGate;
use Everest\Http\Controllers\Api\BlockedExtensionRouteController;
use Everest\Http\Middleware\Api\Client\Server\ResourceBelongsToServer;
use Everest\Http\Middleware\Api\Client\Server\AuthenticateServerAccess;

class ClientExtensionRouteSecurityTest extends TestCase
{
    public function testLoaderBoundarySurvivesRegistrationAndRouteCaching(): void
    {
        $root = sys_get_temp_dir() . '/extension-routes-' . bin2hex(random_bytes(8));
        $appPath = $this->app->path();
        $routeFile = base_path('routes/api-client.php');
        mkdir($root . '/Extensions/Packages/demo/routes', 0777, true);
        mkdir($root . '/Extensions/Packages/disabled/routes', 0777, true);
        file_put_contents($root . '/Extensions/Packages/demo/routes/client.php', <<<'PHP'
<?php
use Illuminate\Support\Facades\Route;
use Everest\Tests\Unit\Services\Extensions\ClientExtensionFixtureController;
use Everest\Http\Middleware\Api\Client\Extensions\EnsureExtensionAccess;
Route::get('/demo/ok', [ClientExtensionFixtureController::class, 'index']);
Route::get('/demo/excluded', [ClientExtensionFixtureController::class, 'index'])->withoutMiddleware('extensions.access:demo');
Route::get('/demo/wrong-id', [ClientExtensionFixtureController::class, 'index'])->middleware('extensions.access:other');
Route::get('/demo/wrong-class-id', [ClientExtensionFixtureController::class, 'index'])->middleware(EnsureExtensionAccess::class . ':other');
$route = Route::get('/demo/substituted', [ClientExtensionFixtureController::class, 'index']);
$action = $route->getAction();
$action['middleware'] = ['extensions.access:other'];
$route->setAction($action);
$route = Route::get('/demo/stripped-auth', [ClientExtensionFixtureController::class, 'index']);
$action = $route->getAction();
$action['middleware'] = ['extensions.access:demo'];
$route->setAction($action);
PHP);
        file_put_contents($root . '/Extensions/Packages/disabled/routes/client.php', '<?php throw new \RuntimeException("Disabled code executed");');

        try {
            $this->app->useAppPath($root);
            (new \ReflectionProperty(ExtensionRuntimeGate::class, 'enabledIds'))->setValue(null, ['demo']);
            Route::setRoutes(new RouteCollection());
            Route::prefix('api/client')->middleware(['api', 'auth:sanctum', 'throttle:api.client'])->group($routeFile);
            $this->assertBoundary();

            // Use Laravel's actual route-cache format and loader in isolation;
            // never overwrite the running panel's bootstrap/cache routes.
            foreach (Route::getRoutes() as $route) {
                $route->prepareForSerialization();
            }
            $cache = str_replace('{{routes}}', var_export(Route::getRoutes()->compile(), true), file_get_contents(base_path('vendor/laravel/framework/src/Illuminate/Foundation/Console/stubs/routes.stub')));
            file_put_contents($root . '/routes.php', $cache);
            require $root . '/routes.php';
            $this->assertBoundary();
        } finally {
            $this->app->useAppPath($appPath);
            ExtensionRuntimeGate::flush();
            app('files')->deleteDirectory($root);
        }
    }

    private function assertBoundary(): void
    {
        foreach (['ok', 'excluded', 'wrong-id', 'wrong-class-id', 'substituted', 'stripped-auth'] as $path) {
            $route = Route::getRoutes()->match(Request::create('/api/client/servers/example/extensions/demo/' . $path));
            $this->assertSame(
                $path === 'ok' ? ClientExtensionFixtureController::class . '@index' : BlockedExtensionRouteController::class . '@__invoke',
                $route->getAction('uses'),
                $path,
            );
            foreach (['auth:sanctum', 'throttle:api.client', AuthenticateServerAccess::class, ResourceBelongsToServer::class, 'extensions.access:demo'] as $middleware) {
                $this->assertContains($middleware, $route->middleware(), $path);
            }
            $this->assertSame([], $route->excludedMiddleware());
        }
    }
}

class ClientExtensionFixtureController
{
    public function index(): void
    {
    }
}
