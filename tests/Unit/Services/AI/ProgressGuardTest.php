<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\ProgressGuard;

/**
 * A turn that is going nowhere should say so, not time out.
 *
 * Step and wall-clock limits already bound a turn, but they bound this failure
 * badly: a model repeating one call twelve times spends the whole budget and
 * then reports a timeout, which tells the user nothing and points the operator
 * at a limit that was never the problem.
 *
 * The hard part is not detection, it is *not* detecting the legitimate cases —
 * polling something that is changing, and paginating through a list. Both look
 * like repetition and neither is.
 */
class ProgressGuardTest extends TestCase
{
    private function guard(): ProgressGuard
    {
        return new ProgressGuard();
    }

    private function context(): AgentContext
    {
        $user = \Mockery::mock(User::class)->makePartial();
        $user->id = 3;

        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';

        return new AgentContext($user, $server, 'turn-progress');
    }

    private function ok(mixed $data): ToolResult
    {
        return ToolResult::ok($data);
    }

    /*
    |--------------------------------------------------------------------------
    | Repetition
    |--------------------------------------------------------------------------
    */

    public function testTheFirstCallIsNeverARepeat(): void
    {
        $verdict = $this->guard()->evaluate($this->context(), 'admin_overview', [], $this->ok(['users' => 4]));

        $this->assertTrue($verdict['result']->ok);
        $this->assertFalse($verdict['halt']);
    }

    /**
     * The second identical call gets a warning it can act on rather than the
     * same payload a second time.
     */
    public function testASecondIdenticalCallIsRefusedWithAnExplanation(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $result = $this->ok(['users' => 4]);

        $guard->evaluate($context, 'admin_overview', [], $result);
        $verdict = $guard->evaluate($context, 'admin_overview', [], $result);

        $this->assertFalse($verdict['result']->ok);
        $this->assertSame('repeated_call', $verdict['result']->code);
        $this->assertFalse($verdict['halt'], 'One repeat is a warning, not a stop.');
    }

    /**
     * The third stops the turn, well inside the twelve-step budget.
     */
    public function testAThirdIdenticalCallStopsTheTurn(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $result = $this->ok(['users' => 4]);

        $guard->evaluate($context, 'admin_overview', [], $result);
        $guard->evaluate($context, 'admin_overview', [], $result);
        $verdict = $guard->evaluate($context, 'admin_overview', [], $result);

        $this->assertTrue($verdict['halt']);
        $this->assertSame('repeated_call', $verdict['result']->code);
    }

    /**
     * Argument order is not identity.
     *
     * Without canonicalisation the guard is defeated by a re-serialisation
     * nobody intended — the model writes the same call with its keys the other
     * way round and it reads as new work.
     */
    public function testArgumentOrderDoesNotMakeACallDifferent(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $result = $this->ok(['ok' => true]);

        $guard->evaluate($context, 'files_list', ['directory' => '/', 'depth' => 1], $result);
        $verdict = $guard->evaluate($context, 'files_list', ['depth' => 1, 'directory' => '/'], $result);

        $this->assertSame('repeated_call', $verdict['result']->code);
    }

    /*
    |--------------------------------------------------------------------------
    | What must keep working
    |--------------------------------------------------------------------------
    */

    /**
     * Polling is fine while the answer is changing.
     */
    public function testPollingContinuesWhileTheResultChanges(): void
    {
        $guard = $this->guard();
        $context = $this->context();

        $guard->evaluate($context, 'server_status', [], $this->ok(['state' => 'starting']));
        $verdict = $guard->evaluate($context, 'server_status', [], $this->ok(['state' => 'running']));

        $this->assertTrue($verdict['result']->ok);
        $this->assertFalse($verdict['halt']);
    }

    /**
     * And fine again after something changed, even when the answer did not.
     *
     * `server_status` returning "offline" twice is a repeat; returning "offline"
     * either side of a restart is the correct way to check whether the restart
     * worked.
     */
    public function testAStateChangeMakesAnIdenticalCallWorthMaking(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $result = $this->ok(['state' => 'offline']);

        $guard->evaluate($context, 'server_status', [], $result);
        $guard->stateChanged($context);
        $verdict = $guard->evaluate($context, 'server_status', [], $result);

        $this->assertTrue($verdict['result']->ok);
    }

    /**
     * Pagination differs in its arguments, so it never trips the guard at all.
     */
    public function testPaginationIsNotRepetition(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $result = $this->ok(['rows' => []]);

        $guard->evaluate($context, 'admin_servers_list', ['page' => 1], $result);
        $verdict = $guard->evaluate($context, 'admin_servers_list', ['page' => 2], $result);

        $this->assertTrue($verdict['result']->ok);
    }

    /**
     * A different tool in between breaks the run.
     *
     * Only *consecutive* repetition counts. A model that checks a file, does
     * something, then checks it again is confirming its own work, which is the
     * behaviour we want rather than the one we are stopping.
     */
    public function testAnInterveningCallBreaksTheRun(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $status = $this->ok(['state' => 'running']);

        $guard->evaluate($context, 'server_status', [], $status);
        $guard->evaluate($context, 'files_list', ['directory' => '/'], $this->ok(['files' => []]));
        $verdict = $guard->evaluate($context, 'server_status', [], $status);

        $this->assertTrue($verdict['result']->ok);
    }

    /**
     * The guard survives an approval.
     *
     * A turn that suspends for half an hour and comes back is still the same
     * turn, and resetting the history there would let a loop restart itself every
     * time a human clicked something.
     */
    public function testSignaturesSurviveSuspensionAndResume(): void
    {
        $guard = $this->guard();
        $context = $this->context();
        $result = $this->ok(['users' => 4]);

        $guard->evaluate($context, 'admin_overview', [], $result);

        $restored = AgentContext::fromState(
            $context->user,
            $context->server,
            $context->turnId,
            null,
            $context->toState(),
        );

        $verdict = $guard->evaluate($restored, 'admin_overview', [], $result);

        $this->assertSame('repeated_call', $verdict['result']->code);
    }
}
