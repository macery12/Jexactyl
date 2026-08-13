<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

/**
 * The console gate is fail-closed: an allowlist of commands known to be
 * informational, with everything else — including anything unrecognised —
 * escalated to typed confirmation.
 */
class ConsoleCommandGateTest extends TestCase
{
    private ConsoleCommandGate $gate;

    public function setUp(): void
    {
        parent::setUp();

        $this->app->bind(SettingsRepositoryInterface::class, fn () => new class () {
            public function get(string $key, mixed $default = null): mixed
            {
                return $default;
            }
        });

        $this->gate = new ConsoleCommandGate();
    }

    /**
     * @return array<int, array{0: string}>
     */
    public static function safeCommandProvider(): array
    {
        return [['list'], ['tps'], ['plugins'], ['seed'], ['version'], ['/list'], ['  LIST  '], ['whitelist list']];
    }

    /**
     * @return array<int, array{0: string}>
     */
    public static function dangerousCommandProvider(): array
    {
        return [
            ['stop'],
            ['restart'],
            ['op someone'],
            ['ban someone'],
            ['kick someone'],
            ['whitelist off'],
            ['gamerule keepInventory false'],
            ['save-off'],
            ['reload confirm'],
            // Not on any denylist anyone would think to write — which is
            // exactly why the gate is an allowlist.
            ['essentials:nuke'],
            ['co rollback t:30d'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('safeCommandProvider')]
    public function testInformationalCommandsAreSafe(string $command): void
    {
        $this->assertTrue($this->gate->isSafe($command), $command . ' should be safe');
        $this->assertSame(ToolDefinition::RISK_WRITE, $this->gate->risk($command));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('dangerousCommandProvider')]
    public function testEverythingElseRequiresTypedConfirmation(string $command): void
    {
        $this->assertFalse($this->gate->isSafe($command), $command . ' should not be safe');
        $this->assertSame(ToolDefinition::RISK_DESTRUCTIVE, $this->gate->risk($command));
    }

    public function testASafeVerbWithArgumentsIsNotTheCommandThatWasVetted(): void
    {
        // "whitelist list" is safe; "whitelist off" is not, and both begin
        // with the same verb.
        $this->assertTrue($this->gate->isSafe('whitelist list'));
        $this->assertFalse($this->gate->isSafe('whitelist off'));
        $this->assertFalse($this->gate->isSafe('list --all; stop'));
    }

    public function testCommandsCarryingASecondCommandAreRejected(): void
    {
        // One approved command must not be able to smuggle an unvetted one
        // through on the same line.
        $this->assertFalse($this->gate->isSafe("list\nstop"));
        $this->assertFalse($this->gate->isSafe("list\r\nban everyone"));
        $this->assertFalse($this->gate->isSafe("list\x00stop"));
    }

    public function testEmptyCommandsAreNotSafe(): void
    {
        $this->assertFalse($this->gate->isSafe(''));
        $this->assertFalse($this->gate->isSafe('   '));
        $this->assertFalse($this->gate->isSafe('/'));
    }

    public function testRiskGateLetsTheConsoleClassifierEscalateButNotRelax(): void
    {
        $riskGate = new RiskGate($this->gate);

        $consoleTool = new ToolDefinition(
            name: 'console_send',
            description: 'x',
            parameters: [],
            method: 'POST',
            uriTemplate: '/x',
            risk: ToolDefinition::RISK_SAFE,
        );

        // Even declared SAFE, a dangerous command still escalates — an
        // operator relaxing the tool must not thereby auto-run `stop`.
        $this->assertSame(
            ToolDefinition::RISK_DESTRUCTIVE,
            $riskGate->resolve($consoleTool, ['command' => 'stop'])
        );

        // A safe command still cannot drop below the tool's declared tier.
        $writeTool = new ToolDefinition(
            name: 'console_send',
            description: 'x',
            parameters: [],
            method: 'POST',
            uriTemplate: '/x',
            risk: ToolDefinition::RISK_WRITE,
        );

        $this->assertSame(
            ToolDefinition::RISK_WRITE,
            $riskGate->resolve($writeTool, ['command' => 'list'])
        );
    }

    public function testAMissingCommandArgumentFailsClosed(): void
    {
        $riskGate = new RiskGate($this->gate);

        $tool = new ToolDefinition(
            name: 'console_send',
            description: 'x',
            parameters: [],
            method: 'POST',
            uriTemplate: '/x',
            risk: ToolDefinition::RISK_WRITE,
        );

        $this->assertSame(ToolDefinition::RISK_DESTRUCTIVE, $riskGate->resolve($tool, []));
    }
}
