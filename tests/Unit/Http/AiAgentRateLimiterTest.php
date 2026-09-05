<?php

namespace Everest\Tests\Unit\Http;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\RateLimiter;

class AiAgentRateLimiterTest extends TestCase
{
    public function testLimiterIsRegisteredAndReadsDedicatedConfig(): void
    {
        config([
            'http.rate_limit.ai_agent_period' => 2,
            'http.rate_limit.ai_agent' => 7,
        ]);

        $limit = $this->resolveLimit();

        $this->assertSame(7, $limit->maxAttempts);
        $this->assertSame(120, $limit->decaySeconds);
        $this->assertStringStartsWith('ai-agent:', $limit->key);
    }

    public function testLimiterIsKeyedToTheAuthenticatedUserRatherThanIp(): void
    {
        $user = (new User())->forceFill([
            'uuid' => '00000000-0000-4000-8000-000000000014',
        ]);

        $first = Request::create('/first', server: ['REMOTE_ADDR' => '192.0.2.1']);
        $first->setUserResolver(fn () => $user);
        $second = Request::create('/second', server: ['REMOTE_ADDR' => '192.0.2.2']);
        $second->setUserResolver(fn () => $user);

        $limiter = RateLimiter::limiter('ai.agent');
        $this->assertNotNull($limiter);

        $firstLimit = $limiter($first);
        $secondLimit = $limiter($second);
        $firstLimit = is_array($firstLimit) ? $firstLimit[0] : $firstLimit;
        $secondLimit = is_array($secondLimit) ? $secondLimit[0] : $secondLimit;

        $this->assertSame($firstLimit->key, $secondLimit->key);
    }

    public function testQueueRetriesHaveASeparateBudgetThatSupportsTheFastestCadence(): void
    {
        config([
            'http.rate_limit.ai_agent_period' => 1,
            'http.rate_limit.ai_agent' => 10,
            'http.rate_limit.ai_agent_retry' => 120,
        ]);

        $limiter = RateLimiter::limiter('ai.agent');
        $this->assertNotNull($limiter);

        $request = Request::create('/api/application/ai/agent', 'POST', [
            'ticket' => '00000000-0000-4000-8000-000000000015',
        ]);
        $limit = $limiter($request);
        $limit = is_array($limit) ? $limit[0] : $limit;

        $this->assertSame(120, $limit->maxAttempts);
        $this->assertStringStartsWith('ai-agent-retry:', $limit->key);
    }

    public function testBothAgentStartRoutesUseTheDedicatedLimiter(): void
    {
        foreach ([
            'api/client/servers/{server}/ai/agent',
            'api/application/ai/agent',
        ] as $uri) {
            $route = collect(Route::getRoutes()->getRoutes())->first(
                fn ($route) => $route->uri() === $uri && in_array('POST', $route->methods(), true)
            );

            $this->assertNotNull($route, "Missing agent start route: {$uri}");
            $this->assertContains('throttle:ai.agent', $route->gatherMiddleware());
        }
    }

    private function resolveLimit(): object
    {
        $limiter = RateLimiter::limiter('ai.agent');
        $this->assertNotNull($limiter, 'The ai.agent rate limiter is not registered.');

        $limit = $limiter(Request::create('/api/application/ai/agent', 'POST'));

        return is_array($limit) ? $limit[0] : $limit;
    }
}
