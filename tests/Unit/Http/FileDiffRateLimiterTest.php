<?php

namespace Everest\Tests\Unit\Http;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\RateLimiter;

class FileDiffRateLimiterTest extends TestCase
{
    public function testLimiterIsRegisteredAndReadsDedicatedConfig(): void
    {
        config([
            'http.rate_limit.file_diff_period' => 2,
            'http.rate_limit.file_diff' => 7,
        ]);

        $limit = $this->resolveLimit();

        $this->assertSame(7, $limit->maxAttempts);
        $this->assertSame(120, $limit->decaySeconds);
        $this->assertStringStartsWith('file-diff:', $limit->key);
    }

    public function testLimiterIsKeyedToTheAuthenticatedUserRatherThanIp(): void
    {
        $user = (new User())->forceFill([
            'uuid' => '00000000-0000-4000-8000-000000000013',
        ]);

        $first = Request::create('/first', server: ['REMOTE_ADDR' => '192.0.2.1']);
        $first->setUserResolver(fn () => $user);
        $second = Request::create('/second', server: ['REMOTE_ADDR' => '192.0.2.2']);
        $second->setUserResolver(fn () => $user);

        $limiter = RateLimiter::limiter('file.diff');
        $this->assertNotNull($limiter);

        $firstLimit = $limiter($first);
        $secondLimit = $limiter($second);
        $firstLimit = is_array($firstLimit) ? $firstLimit[0] : $firstLimit;
        $secondLimit = is_array($secondLimit) ? $secondLimit[0] : $secondLimit;

        $this->assertSame($firstLimit->key, $secondLimit->key);
    }

    public function testRequestsBeyondDedicatedBudgetReceive429(): void
    {
        config([
            'http.rate_limit.file_diff_period' => 1,
            'http.rate_limit.file_diff' => 2,
        ]);

        Route::post('/_tests/file-diff-rate-limit', fn () => response()->json(['ok' => true]))
            ->middleware('throttle:file.diff');

        $this->postJson('/_tests/file-diff-rate-limit')->assertOk();
        $this->postJson('/_tests/file-diff-rate-limit')->assertOk();
        $this->postJson('/_tests/file-diff-rate-limit')
            ->assertStatus(429)
            ->assertJsonPath('errors.0.detail', 'Too many file diff requests. Please wait before saving again.');
    }

    public function testProductionRouteUsesTheDedicatedLimiter(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())->first(
            fn ($route) => $route->uri() === 'api/client/servers/{server}/files/write-with-diff'
        );

        $this->assertNotNull($route);
        $this->assertContains('throttle:file.diff', $route->gatherMiddleware());
    }

    private function resolveLimit(): object
    {
        $limiter = RateLimiter::limiter('file.diff');
        $this->assertNotNull($limiter, 'The file.diff rate limiter is not registered.');

        $limit = $limiter(Request::create('/api/client/servers/test/files/write-with-diff'));

        return is_array($limit) ? $limit[0] : $limit;
    }
}
