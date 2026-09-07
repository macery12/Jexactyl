<?php

namespace Everest\Tests\Unit\Services\Extensions;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Route;
use Illuminate\Routing\Route as RoutingRoute;
use Everest\Services\Extensions\ExtensionRouteGuardService;
use Everest\Http\Controllers\Api\BlockedExtensionRouteController;

class ExtensionRouteGuardServiceTest extends TestCase
{
    private ExtensionRouteGuardService $service;

    public function setUp(): void
    {
        parent::setUp();

        $this->service = new ExtensionRouteGuardService();
    }

    public function testCompliantRouteIsLeftUntouched(): void
    {
        $this->service->registerAndAudit('demo', ['extensions.admin:demo'], function () {
            Route::group([
                'prefix' => '/ext/demo',
                'middleware' => ['extensions.admin:demo'],
            ], function () {
                Route::get('/ok', fn () => 'ok');
            });
        });

        $route = $this->findRoute('ext/demo/ok');
        $this->assertNotNull($route);
        $this->assertNotSame(
            BlockedExtensionRouteController::class . '@__invoke',
            $route->getAction('uses')
        );
        $this->assertContains('extensions.admin:demo', $route->middleware());
    }

    public function testRouteStrippingMiddlewareIsDropped(): void
    {
        $this->service->registerAndAudit('demo', ['extensions.admin:demo'], function () {
            Route::group([
                'prefix' => '/ext/demo',
                'middleware' => ['extensions.admin:demo'],
            ], function () {
                Route::get('/sneaky', fn () => 'secrets')->withoutMiddleware('auth:sanctum');
            });
        });

        $route = $this->findRoute('ext/demo/sneaky');
        $this->assertNotNull($route);
        $this->assertSame(
            BlockedExtensionRouteController::class . '@__invoke',
            $route->getAction('uses')
        );
        // The exclusion is discarded so even the 404 route sheds nothing.
        $this->assertSame([], $route->excludedMiddleware());
        // The gate is still on the (now blocked) route.
        $this->assertContains('extensions.admin:demo', $route->middleware());
    }

    public function testRouteMissingRequiredGateIsDropped(): void
    {
        $this->service->registerAndAudit('demo', ['extensions.admin:demo'], function () {
            // Registered outside the gated group, e.g. a hand-rolled Route::
            // call that escaped the wrapper.
            Route::get('/ext/demo/ungated', fn () => 'oops');
        });

        $route = $this->findRoute('ext/demo/ungated');
        $this->assertNotNull($route);
        $this->assertSame(
            BlockedExtensionRouteController::class . '@__invoke',
            $route->getAction('uses')
        );
    }

    public function testRouteMissingAnyRequiredMiddlewareIsDropped(): void
    {
        $this->service->registerAndAudit('demo', ['extensions.admin:demo', 'throttle:api.ext-admin'], function () {
            // Carries the gate but not the throttle — still dropped.
            Route::get('/ext/demo/unthrottled', fn () => 'oops')
                ->middleware('extensions.admin:demo');
        });

        $route = $this->findRoute('ext/demo/unthrottled');
        $this->assertNotNull($route);
        $this->assertSame(
            BlockedExtensionRouteController::class . '@__invoke',
            $route->getAction('uses')
        );
    }

    public function testAuditOnlyCoversRoutesAddedByTheCallback(): void
    {
        Route::get('/pre-existing-unrelated', fn () => 'fine')->withoutMiddleware('auth:sanctum');

        $this->service->registerAndAudit('demo', [], function () {
            Route::get('/ext/demo/clean', fn () => 'ok');
        });

        $untouched = $this->findRoute('pre-existing-unrelated');
        $this->assertNotNull($untouched);
        $this->assertNotSame(
            BlockedExtensionRouteController::class . '@__invoke',
            $untouched->getAction('uses')
        );
        $this->assertNotSame([], $untouched->excludedMiddleware());
    }

    public function testSubstitutedMiddlewareAliasIsRestoredAndRouteBlocked(): void
    {
        $original = Route::getMiddleware()['extensions.access'];
        $this->service->registerAndAudit('demo', ['extensions.access:demo'], function () {
            Route::aliasMiddleware('extensions.access', \stdClass::class);
            Route::get('/ext/demo/substituted-alias', fn () => 'oops')->middleware('extensions.access:demo');
        });
        $this->assertSame($original, Route::getMiddleware()['extensions.access']);
        $this->assertSame(BlockedExtensionRouteController::class . '@__invoke', $this->findRoute('ext/demo/substituted-alias')->getAction('uses'));
    }

    private function findRoute(string $uri): ?RoutingRoute
    {
        foreach (Route::getRoutes()->getRoutes() as $route) {
            if ($route->uri() === $uri) {
                return $route;
            }
        }

        return null;
    }
}
