<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Agent\TurnExecutionPolicy;
use Everest\Services\AI\Tools\Definitions\AdminTools;

class TurnExecutionPolicyTest extends TestCase
{
    public function testDiagnosisWithoutARequestedFixCreatesAReadOnlyTurn(): void
    {
        $context = $this->context();
        $guard = new TurnExecutionPolicy();

        $guard->apply($context, 'Diagnose why the server will not start.');

        $this->assertSame(TurnExecutionPolicy::MODE_READ_ONLY, $context->turnMode);
        $this->assertTrue($guard->permits($context, $this->tool('server_status')));
        $this->assertFalse($guard->permits($context, $this->tool('server_power')));
        $this->assertSame('read_only_turn', $guard->refusal($context, $this->tool('server_power'))->code);
    }

    public function testDiagnosisAndAnExplicitFixKeepsStandardAuthority(): void
    {
        $context = $this->context();
        (new TurnExecutionPolicy())->apply($context, 'Diagnose the problem, fix it, and restart the server.');

        $this->assertSame(TurnExecutionPolicy::MODE_STANDARD, $context->turnMode);
    }

    public function testAskingHowToFixAProblemDoesNotAuthorizeTheModelToDoIt(): void
    {
        $context = $this->context();

        (new TurnExecutionPolicy())->apply(
            $context,
            'Diagnose the problem and tell me how I should fix it or restart it myself.',
        );

        $this->assertSame(TurnExecutionPolicy::MODE_READ_ONLY, $context->turnMode);
    }

    public function testReadOnlyAssistOpeningRemainsAvailableButEscalationDoesNot(): void
    {
        $context = new AgentContext(User::factory()->make(), null, 'turn-read-only-admin');
        $guard = new TurnExecutionPolicy();
        $guard->apply($context, 'Read the ticket and diagnose only; do not change anything.');

        $this->assertTrue($guard->permits($context, $this->tool(AdminTools::ASSIST_SERVER)));
        $this->assertFalse($guard->permits($context, $this->tool(AdminTools::ASSIST_ALLOW_WRITES)));
    }

    public function testAuthoritySurvivesASuspendedTurnRoundTrip(): void
    {
        $context = $this->context();
        (new TurnExecutionPolicy())->apply($context, 'Inspect only and make no changes.');

        $restored = AgentContext::fromState(
            $context->user,
            $context->server,
            $context->turnId,
            null,
            $context->toState(),
        );

        $this->assertSame(TurnExecutionPolicy::MODE_READ_ONLY, $restored->turnMode);
        $this->assertNotNull($restored->turnModeReason);
    }

    public function testRunnerRefusesAWriteBeforeCreatingAnApproval(): void
    {
        $context = $this->context();
        (new TurnExecutionPolicy())->apply($context, 'Diagnose why the server will not start.');
        $definition = $this->tool('server_power');
        $events = [];
        $handle = new \ReflectionMethod(AgentRunner::class, 'handleCall');

        $outcome = $handle->invoke(
            app(AgentRunner::class),
            $context,
            new AiToolCall('blocked-restart', 'server_power', ['signal' => 'restart']),
            [$definition],
            static function (AgentEvent $event) use (&$events): void {
                $events[] = $event->type;
            },
        );

        $payload = json_decode((string) $context->messages[array_key_last($context->messages)]->content, true);

        $this->assertSame('continued', $outcome);
        $this->assertSame('read_only_turn', $payload['error']);
        $this->assertNotContains(AgentEvent::TYPE_APPROVAL_REQUIRED, $events);
        $this->assertNotContains(AgentEvent::TYPE_TOOL_CALL, $events);
    }

    private function context(): AgentContext
    {
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Authority test';

        return new AgentContext(User::factory()->make(), $server, 'turn-authority-test');
    }

    private function tool(string $name): \Everest\Services\AI\Tools\ToolDefinition
    {
        return app(ToolRegistry::class)->find($name)
            ?? throw new \RuntimeException('Missing test tool ' . $name);
    }
}
