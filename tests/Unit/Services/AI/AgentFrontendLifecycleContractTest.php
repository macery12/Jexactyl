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

    public function testApprovalTargetsRemainExactScrollableAndBidiIsolated(): void
    {
        $meta = file_get_contents(base_path('frontend/src/components/ai/toolMeta.tsx'));
        $card = file_get_contents(base_path('frontend/src/components/ai/ApprovalCard.tsx'));

        $sharedPrefix = '/srv/' . str_repeat('same-prefix-', 12);
        $first = $sharedPrefix . "\u{202E}alpha\u{2066}/world-one.json";
        $second = $sharedPrefix . "\u{202E}alpha\u{2066}/world-two.json";

        $this->assertNotSame($first, $second);
        $this->assertSame($sharedPrefix, mb_substr($first, 0, mb_strlen($sharedPrefix)));
        $this->assertSame($sharedPrefix, mb_substr($second, 0, mb_strlen($sharedPrefix)));
        $this->assertStringContainsString("\u{202E}", $first);
        $this->assertStringContainsString("\u{2066}", $first);

        $this->assertStringContainsString('return String(value);', $meta);
        $this->assertStringNotContainsString('text.slice(', $meta);
        $this->assertStringContainsString('data-ai-approval-target={target}', $card);
        $this->assertStringContainsString('dir="ltr"', $card);
        $this->assertStringContainsString('overflow-x-auto whitespace-pre', $card);
        $this->assertStringContainsString('style={{ unicodeBidi:', $card);
        $this->assertStringContainsString('<bdi dir="ltr">{target}</bdi>', $card);
        $this->assertGreaterThanOrEqual(2, substr_count($card, '<ExactApprovalTarget target={target} />'));
    }

    public function testCustomerAgentRouteDrawerAndPageShareTheDedicatedKillSwitch(): void
    {
        $route = file_get_contents(base_path('frontend/src/routes/server.routes.ts'));
        $drawer = file_get_contents(base_path('frontend/src/components/ai/AgentDrawer.tsx'));
        $page = file_get_contents(base_path('frontend/src/pages/server/ai/AiPage.tsx'));
        $chat = file_get_contents(base_path('frontend/src/components/ai/AgentChat.tsx'));
        $composer = file_get_contents(base_path('app/Http/ViewComposers/EverestComposer.php'));

        $this->assertStringContainsString("'feature_agent' => boolval(config('modules.ai.agent.enabled'", $composer);
        $this->assertStringContainsString('f.ai.enabled && f.ai.feature_agent', $route);
        $this->assertStringNotContainsString('f.ai.feature_server_assistant', $route);

        foreach ([$drawer, $page, $chat] as $source) {
            $this->assertStringContainsString('everest?.ai.enabled && everest.ai.feature_agent', $source);
            $this->assertStringNotContainsString('feature_server_assistant', $source);
            $this->assertStringNotContainsString('admin_role_id', $source);
        }
    }

    public function testTranscriptLoadsAreBoundToTargetConversationAndLatestGeneration(): void
    {
        $store = file_get_contents(base_path('frontend/src/state/agentChat.ts'));
        $serverPage = file_get_contents(base_path('frontend/src/pages/server/ai/AiPage.tsx'));
        $adminPage = file_get_contents(base_path('frontend/src/pages/admin/assistant/AssistantPage.tsx'));

        $this->assertStringContainsString('beginTranscriptLoad: (target: string, conversationId: number) => number', $store);
        $this->assertStringContainsString('request.target !== target', $store);
        $this->assertStringContainsString('request.conversationId !== conversationId', $store);
        $this->assertStringContainsString('request.generation !== generation', $store);
        $this->assertStringContainsString('++transcriptGeneration', $store);
        $this->assertStringContainsString('const generation = beginTranscriptLoad(target, conv.id)', $serverPage);
        $this->assertStringContainsString('loadTranscript(target, conv.id, generation, messages, redactions)', $serverPage);
        $this->assertStringContainsString('beginTranscriptLoad(ADMIN_AGENT_TARGET, id)', $adminPage);
        $this->assertStringContainsString('if (applied && conversation.assist)', $adminPage);
    }

    public function testReusedCallIdsOnlyUpdateTheLatestUnresolvedRowAndReplayAsAQueue(): void
    {
        $store = file_get_contents(base_path('frontend/src/state/agentChat.ts'));

        $this->assertStringContainsString('const latestOpenToolIndex', $store);
        $this->assertStringContainsString("entry.status === 'pending' || entry.status === 'running'", $store);
        $this->assertStringContainsString('const announced = latestOpenToolIndex(state.entries, event.id)', $store);
        $this->assertStringContainsString('const matching = latestOpenToolIndex(state.entries, event.id)', $store);
        $this->assertStringContainsString('pendingArgs.get(message.tool_call_id)?.shift()', $store);
        $this->assertStringContainsString('batchParentCallId', $store);
        $this->assertStringContainsString('batchIndex', $store);
    }
}
