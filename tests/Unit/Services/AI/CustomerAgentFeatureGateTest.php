<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Everest\Http\Controllers\Api\Client\Servers\AgentController;

class CustomerAgentFeatureGateTest extends TestCase
{
    /**
     * Account privilege must have no effect on the customer agent. Its master
     * module and dedicated switch are the whole admission decision.
     */
    public function testEveryFlagCombinationTreatsOrdinaryUsersAndOwnersEqually(): void
    {
        $method = new \ReflectionMethod(AgentController::class, 'assertAgentEnabled');
        $controller = (new \ReflectionClass(AgentController::class))->newInstanceWithoutConstructor();

        try {
            $this->forgetFlags();
            foreach ([false, true] as $moduleEnabled) {
                foreach ([false, true] as $agentEnabled) {
                    $this->flags($moduleEnabled, $agentEnabled);

                    foreach ([false, true] as $owner) {
                        $request = Request::create('/api/client/servers/server/ai/agent', 'POST');
                        $request->setUserResolver(fn () => $this->user($owner));
                        $allowed = $moduleEnabled && $agentEnabled;

                        try {
                            $method->invoke($controller, $request);
                            $this->assertTrue($allowed, $this->caseName($moduleEnabled, $agentEnabled, $owner));
                        } catch (HttpException $e) {
                            $this->assertFalse($allowed, $this->caseName($moduleEnabled, $agentEnabled, $owner));
                            $this->assertSame(403, $e->getStatusCode());
                        }
                    }
                }
            }
        } finally {
            $this->forgetFlags();
        }
    }

    public function testDisabledAgentRefusesEveryDirectEndpointForOrdinaryUsersAndOwners(): void
    {
        $controller = (new \ReflectionClass(AgentController::class))->newInstanceWithoutConstructor();
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $this->forgetFlags();
        $this->flags(true, false);

        try {
            foreach ([false, true] as $owner) {
                foreach (['start', 'activeTurn', 'turnStatus', 'decide'] as $method) {
                    $request = Request::create('/api/client/servers/server/ai/agent', 'POST');
                    $request->setUserResolver(fn () => $this->user($owner));

                    try {
                        $method === 'turnStatus'
                            ? $controller->{$method}($request, $server, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
                            : $controller->{$method}($request, $server);
                        $this->fail(sprintf('%s should be disabled for owner=%s.', $method, $owner ? 'yes' : 'no'));
                    } catch (HttpException $e) {
                        $this->assertSame(403, $e->getStatusCode());
                    }
                }
            }
        } finally {
            $this->forgetFlags();
        }
    }

    private function flags(bool $module, bool $agent): void
    {
        config()->set('modules.ai.enabled', $module);
        config()->set('modules.ai.agent.enabled', $agent);
    }

    private function forgetFlags(): void
    {
        Setting::forget('settings::modules:ai:enabled');
        Setting::forget('settings::modules:ai:agent:enabled');
    }

    private function user(bool $owner): User
    {
        $profile = null;
        if ($owner) {
            $profile = new AdminRole();
            $profile->forceFill(['id' => 1, 'is_owner' => true]);
        }

        $user = new User();
        $user->forceFill(['id' => $owner ? 2 : 1, 'admin_role_id' => $profile?->id]);
        $user->setRelation('adminRole', $profile);

        return $user;
    }

    private function caseName(bool $module, bool $agent, bool $owner): string
    {
        return sprintf(
            'module=%s agent=%s owner=%s',
            $module ? 'on' : 'off',
            $agent ? 'on' : 'off',
            $owner ? 'yes' : 'no',
        );
    }
}
