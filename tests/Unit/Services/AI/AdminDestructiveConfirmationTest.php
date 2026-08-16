<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\AiPendingAction;
use Everest\Tests\TestCase;
use Everest\Services\AI\Agent\AssistBinding;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\ApprovalPreview;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Http\Controllers\Api\Application\AiAgentController;
use Everest\Http\Requests\Api\Application\Intelligence\AgentDecisionRequest;
use Symfony\Component\HttpKernel\Exception\HttpException;

class AdminDestructiveConfirmationTest extends TestCase
{
    public function testMissingIncorrectAndStaleNamesAreRejected(): void
    {
        foreach ([null, 'Different server', 'Old server name', 'current server name'] as $confirmation) {
            try {
                $this->assertConfirmation($confirmation, ToolDefinition::RISK_DESTRUCTIVE);
                $this->fail('The destructive confirmation should have been rejected.');
            } catch (HttpException $e) {
                $this->assertSame(422, $e->getStatusCode());
            }
        }
    }

    public function testTheExactCurrentServerNameAllowsApproval(): void
    {
        $this->assertConfirmation('Current Server Name', ToolDefinition::RISK_DESTRUCTIVE);
        $this->addToAssertionCount(1);
    }

    public function testNonDestructiveApprovalDoesNotRequireAConfirmation(): void
    {
        $this->assertConfirmation(null, ToolDefinition::RISK_WRITE);
        $this->addToAssertionCount(1);
    }

    public function testPreviewUsesTheLiveTargetNameRatherThanSerializedAssistName(): void
    {
        $server = $this->server();
        $preview = ApprovalPreview::for('console_send', ['command' => 'ban player'], $server);

        $this->assertSame('confirmation', $preview['kind']);
        $this->assertSame('Current Server Name', $preview['name']);
        $this->assertSame('11111111', $preview['identifier']);
    }

    private function assertConfirmation(?string $confirmation, string $risk): void
    {
        $server = $this->server();
        $user = new User();
        $context = new AgentContext($user, null, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
        $context->bindAssist(new AssistBinding(
            $server->uuid,
            'Old server name',
            'Support request',
            AssistBinding::WRITE_ABILITIES,
            null,
            true,
        ), $server);

        $pending = (new AiPendingAction())->forceFill([
            'risk' => $risk,
            'tool_name' => 'console_send',
            'arguments' => ['command' => 'ban player'],
        ]);
        $request = AgentDecisionRequest::create('/decide', 'POST', [
            'turn_id' => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            'decision' => 'approve',
            'confirmation' => $confirmation,
        ]);

        $controller = (new \ReflectionClass(AiAgentController::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod(AiAgentController::class, 'assertConfirmed');
        $method->invoke($controller, $request, $pending, $context);
    }

    private function server(): Server
    {
        return (new Server())->forceFill([
            'uuid' => '11111111-2222-4333-8444-555555555555',
            'uuidShort' => '11111111',
            'name' => 'Current Server Name',
        ]);
    }
}
