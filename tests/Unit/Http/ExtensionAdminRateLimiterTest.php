<?php

namespace Everest\Tests\Unit\Http;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\RateLimiter;

class ExtensionAdminRateLimiterTest extends TestCase
{
    public function testLimiterIsRegisteredAndReadsConfig(): void
    {
        config(['http.rate_limit.ext_admin' => 42]);

        $limit = $this->resolveLimit('/api/application/extensions/ext/demo_ext/health');

        $this->assertSame(42, $limit->maxAttempts);
    }

    public function testKeyIsScopedPerExtension(): void
    {
        $first = $this->resolveLimit('/api/application/extensions/ext/first_ext/a');
        $second = $this->resolveLimit('/api/application/extensions/ext/second_ext/a');

        $this->assertNotSame($first->key, $second->key);
        $this->assertStringContainsString('first_ext', $first->key);
        $this->assertStringContainsString('second_ext', $second->key);
    }

    public function testRequestsBeyondTheBudgetAre429edWithoutAffectingOtherExtensions(): void
    {
        config(['http.rate_limit.ext_admin' => 2]);

        Route::get('/api/application/extensions/ext/demo_ext/ping', fn () => response()->json(['ok' => true]))
            ->middleware('throttle:api.ext-admin');
        Route::get('/api/application/extensions/ext/other_ext/ping', fn () => response()->json(['ok' => true]))
            ->middleware('throttle:api.ext-admin');

        $this->getJson('/api/application/extensions/ext/demo_ext/ping')->assertOk();
        $this->getJson('/api/application/extensions/ext/demo_ext/ping')->assertOk();
        $this->getJson('/api/application/extensions/ext/demo_ext/ping')->assertStatus(429);

        // A different extension has its own untouched budget for the same caller.
        $this->getJson('/api/application/extensions/ext/other_ext/ping')->assertOk();
    }

    private function resolveLimit(string $path): object
    {
        $limiter = RateLimiter::limiter('api.ext-admin');
        $this->assertNotNull($limiter, 'The api.ext-admin rate limiter is not registered.');

        $limit = $limiter(Request::create($path));

        return is_array($limit) ? $limit[0] : $limit;
    }
}
