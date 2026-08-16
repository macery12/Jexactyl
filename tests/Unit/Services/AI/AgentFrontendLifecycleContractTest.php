<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;

class AgentFrontendLifecycleContractTest extends TestCase
{
    public function testStreamRequiresSentinelAndRejectsMalformedFrames(): void
    {
        $source = file_get_contents(base_path('frontend/src/lib/aiStream.ts'));

        $this->assertStringContainsString('closed before the turn completed', $source);
        $this->assertStringContainsString('sent malformed stream data', $source);
        $this->assertStringNotContainsString('if (!finished) onComplete()', $source);
    }

    public function testDecisionsCommitOnlyAfterHttpAcknowledgement(): void
    {
        $source = file_get_contents(base_path('frontend/src/state/agentChat.ts'));

        $committed = strpos($source, "decision: decision === 'approve' ? 'approved' : 'rejected'");
        $accepted = strrpos(substr($source, 0, $committed), 'onAccepted: () =>');
        $submitting = strrpos(substr($source, 0, $accepted), "submission: 'submitting'");

        $this->assertIsInt($submitting);
        $this->assertIsInt($accepted);
        $this->assertIsInt($committed);
        $this->assertLessThan($accepted, $submitting);
        $this->assertLessThan($committed, $accepted);
        $this->assertStringContainsString("submission: 'failed'", $source);
        $this->assertStringContainsString('failSubmission(error.message)', $source);
    }

    public function testWatchdogUsesServerLimitAndReconcilesAcceptedDisconnects(): void
    {
        $stream = file_get_contents(base_path('frontend/src/lib/aiStream.ts'));
        $store = file_get_contents(base_path('frontend/src/state/agentChat.ts'));

        $this->assertStringContainsString("headers.get('X-Agent-Idle-Seconds')", $stream);
        $this->assertStringContainsString("headers.get('X-Agent-Turn-Id')", $stream);
        $this->assertStringContainsString('adapter.reconcileTurn(target, turnId)', $store);
        $this->assertStringContainsString('state.pending', $store);
        $this->assertStringContainsString('if (streamAccepted && activeTurnId !== null)', $store);
    }

    public function testDoneSentinelFollowsTerminalPersistence(): void
    {
        $source = file_get_contents(base_path('app/Http/Controllers/Api/Concerns/HandlesAgentTurns.php'));
        $record = strrpos($source, 'app(AiTurnUsageRecorder::class)->record');
        $done = strrpos($source, "write('data: [DONE]')");

        $this->assertIsInt($record);
        $this->assertIsInt($done);
        $this->assertLessThan($done, $record);
        $this->assertStringContainsString('if ($persistenceFailed)', $source);
    }
}
