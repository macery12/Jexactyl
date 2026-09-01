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

    /**
     * A refusal before the stream opens has to survive to the screen.
     *
     * The panel answers its own API in a JSON:API envelope, and the reader only
     * understood `error` and `message` — so a busy queue, a lapsed place or a
     * turn the user already has running all arrived as "Request failed (503)",
     * discarding a sentence written for exactly this reader. The handler's
     * shape and the reader's have to be pinned together or they drift apart in
     * silence: nothing throws, the user just stops being told why.
     */
    public function testPreStreamRefusalsAreReadInThePanelsOwnErrorShape(): void
    {
        $reader = file_get_contents(base_path('frontend/src/lib/aiStream.ts'));
        $handler = file_get_contents(base_path('app/Exceptions/Handler.php'));
        $trait = file_get_contents(base_path('app/Http/Controllers/Api/Concerns/HandlesAgentTurns.php'));

        $this->assertStringContainsString('data?.errors?.[0]?.detail', $reader);
        $this->assertStringContainsString("'detail' => \$e instanceof HttpExceptionInterface", $handler);

        // And admission refusals have to become an HttpException to reach that
        // branch at all: the gate's own exception type renders as a bare 500.
        $this->assertStringContainsString('ServiceUnavailableHttpException', $trait);
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
        $this->assertStringContainsString('toolTargetKey(entry.tool)', $card);
        $this->assertStringContainsString('spoken.add(targetKey)', $card);
    }

    public function testConversationHistoryIsUsableOnSmallScreensAndDeletionIsAcknowledged(): void
    {
        $serverPage = file_get_contents(base_path('frontend/src/pages/server/ai/AiPage.tsx'));
        $adminPage = file_get_contents(base_path('frontend/src/pages/admin/assistant/AssistantPage.tsx'));
        $sharedRail = file_get_contents(base_path('frontend/src/components/ai/ConversationRail.tsx'));
        $delete = file_get_contents(base_path('frontend/src/components/ai/DeleteConversationModal.tsx'));

        foreach ([$serverPage, $adminPage] as $page) {
            $this->assertStringContainsString("window.matchMedia('(min-width: 1024px)')", $page);
            $this->assertStringContainsString('absolute inset-y-0 left-0 z-20', $page);
            $this->assertStringContainsString('lg:static', $page);
            $this->assertStringContainsString('closeMobileRail', $page);
            $this->assertStringContainsString("m['server.ai.showHistory']()", $page);
            $this->assertStringContainsString('@/components/ai/ConversationRail', $page);
        }

        // Hover cannot be a requirement on a touch screen.
        $this->assertStringContainsString(
            'opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
            $sharedRail,
        );
        $this->assertStringContainsString(
            'lg:pointer-events-none lg:opacity-0 lg:group-hover:pointer-events-auto lg:group-hover:opacity-100',
            $sharedRail,
        );

        // The irreversible request begins only in the confirmation dialog. A
        // failure keeps it mounted; success is the only mutation path that
        // closes it.
        $this->assertStringContainsString('mutationFn: onDelete', $delete);
        $this->assertStringContainsString('onSuccess: onClose', $delete);
        $this->assertStringContainsString('onError:', $delete);
        $this->assertStringContainsString("m['server.ai.deleteBody']", $delete);
        $this->assertStringContainsString('<DeleteConversationModal', $serverPage);
        $this->assertStringContainsString('<DeleteConversationModal', $adminPage);
    }

    public function testAiRequestFailuresDoNotMasqueradeAsEmptyOrDisabledStates(): void
    {
        $section = file_get_contents(base_path('frontend/src/pages/admin/ai/AiSection.tsx'));
        $assistant = file_get_contents(base_path('frontend/src/pages/admin/assistant/AssistantPage.tsx'));
        $overview = file_get_contents(base_path('frontend/src/pages/admin/ai/pages/OverviewPage.tsx'));
        $logs = file_get_contents(base_path('frontend/src/pages/admin/ai/pages/LogsPage.tsx'));
        $tools = file_get_contents(base_path('frontend/src/pages/admin/ai/pages/ToolsPage.tsx'));

        foreach ([$section, $assistant, $overview, $logs, $tools] as $source) {
            $this->assertStringContainsString('isError', $source);
            $this->assertStringContainsString('AiLoadError', $source);
        }

        $this->assertStringContainsString('connectionError', $overview);
        $this->assertStringContainsString('retest.isError', $overview);
        $this->assertStringContainsString('logsError', $overview);
        $this->assertStringContainsString('statsError', $overview);
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
        $this->assertStringContainsString(
            'beginTranscriptLoad(ADMIN_AGENT_TARGET, conversation.id)',
            $adminPage,
        );
        $this->assertStringContainsString('if (applied && loaded.assist)', $adminPage);
    }

    /**
     * AI-035. One turn limit, four places that have to agree on it.
     *
     * The runtime clamped to 30 seconds and validation accepted 15, so an
     * operator could save a value, be shown it back, and never have the agent
     * use it. A clamp nobody can see is worse than a validation error anybody
     * can, so the bounds are one definition now and this is what says the other
     * three still match it.
     */
    public function testTheTurnWallLimitAgreesAcrossRuntimeValidationAndTheForm(): void
    {
        $runner = app(\Everest\Services\AI\Agent\AgentRunner::class);
        $rules = (new \Everest\Http\Requests\Api\Application\Intelligence\UpdateIntelligenceSettingsRequest())->rules();
        $form = file_get_contents(base_path('frontend/src/pages/admin/ai/pages/AgentPage.tsx'));

        $this->assertSame(30, \Everest\Services\AI\Agent\AgentRunner::MIN_WALL_SECONDS);
        $this->assertSame(900, \Everest\Services\AI\Agent\AgentRunner::MAX_WALL_SECONDS);
        $this->assertSame('nullable|integer|min:30|max:900', $rules['agent.max_wall_seconds']);

        // The runtime honours the whole accepted range and nothing outside it.
        \Everest\Models\Setting::forget('settings::modules:ai:agent:max_wall_seconds');

        foreach ([[15, 30], [30, 30], [180, 180], [900, 900], [5000, 900]] as [$stored, $effective]) {
            config()->set('modules.ai.agent.max_wall_seconds', $stored);
            $this->assertSame($effective, $runner->maxWallSeconds(), 'stored ' . $stored);
        }

        $this->assertStringContainsString('min={30}', $form);
        $this->assertStringNotContainsString('min={15}', $form);
    }

    /**
     * AI-035. `max_repairs` was validated, stored, read at runtime and simply
     * absent from the form — settable only by an operator who knew the API.
     */
    public function testEveryValidatedAgentSettingHasAControl(): void
    {
        $form = file_get_contents(base_path('frontend/src/pages/admin/ai/pages/AgentPage.tsx'));
        $rules = (new \Everest\Http\Requests\Api\Application\Intelligence\UpdateIntelligenceSettingsRequest())->rules();

        foreach (array_keys($rules) as $key) {
            if (!str_starts_with($key, 'agent.')) {
                continue;
            }

            $field = substr($key, strlen('agent.'));
            $this->assertStringContainsString($field, $form, $key . ' is settable by API but not by the form.');
        }
    }

    /**
     * AI-041. Approval is gated on every security-significant child being read.
     *
     * The displayed list always matched what would execute, which is not the
     * same as reviewed: calls seven onward were folded away, every call's
     * arguments were folded shut, and the approve button stayed live throughout
     * — so one click could commit a tail nobody had seen, with a summary the
     * model wrote about its own work standing in for the evidence.
     */
    public function testBatchApprovalIsBlockedUntilEveryUnsafeChildIsOpened(): void
    {
        $preview = file_get_contents(base_path('frontend/src/components/ai/BatchPreview.tsx'));
        $card = file_get_contents(base_path('frontend/src/components/ai/ApprovalCard.tsx'));

        // The gate itself: the button the user presses is disabled while
        // anything is outstanding, and the count comes from the same function
        // the list renders from.
        $this->assertStringContainsString('export function unreviewedBatchCalls', $preview);
        $this->assertStringContainsString("return risk !== 'safe';", $preview);
        $this->assertStringContainsString('batchChildNeedsReview(call.risk) && !reviewed.has(index)', $preview);
        $this->assertStringContainsString('unreviewedBatchCalls(entry.preview, reviewed)', $card);
        $this->assertStringContainsString('const blocked = unreviewed > 0', $card);
        $this->assertStringContainsString('disabled={disabled || submitting || blocked}', $card);

        // Reviewing is recorded by the card, not by the list — a gate the
        // control it guards cannot see is not a gate.
        $this->assertStringContainsString('reviewed: ReadonlySet<number>', $preview);
        $this->assertStringContainsString('onReview: (indices: number[]) => void', $preview);
        $this->assertStringContainsString('const [reviewed, setReviewed] = useState<ReadonlySet<number>>', $card);

        // Declining is never gated: saying no to twenty unread calls must stay
        // one click.
        $decline = strpos($card, "onDecide('reject')");
        $this->assertIsInt($decline);
        $this->assertStringContainsString(
            'disabled={disabled || submitting}',
            substr($card, $decline - 200, 200),
        );

        // And the model's own sentence is labelled as the model's, rather than
        // presented as the evidence.
        $this->assertStringContainsString("m['server.ai.batch.summaryLabel']()", $preview);

        $messages = json_decode(file_get_contents(base_path('frontend/messages/en.json')), true);
        foreach ([
            'server.ai.batch.summaryLabel',
            'server.ai.batch.reviewAll',
            'server.ai.batch.unreviewed',
            'server.ai.batch.noArguments',
            'server.ai.approval.batchUnreviewed',
        ] as $key) {
            $this->assertArrayHasKey($key, $messages, $key);
        }
    }

    /**
     * Stop has to reach the server (DESIGN-003).
     *
     * The old `cancel()` aborted the fetch and nothing else, which stopped the
     * browser reading while the turn carried on spending budget and running
     * tools. A regression here is invisible — the button still appears to work
     * — so what is pinned is that the request is actually made.
     */
    public function testStoppingATurnReachesTheBackendAndNotOnlyTheReader(): void
    {
        $store = file_get_contents(base_path('frontend/src/state/agentChat.ts'));
        $api = file_get_contents(base_path('frontend/src/api/ai.ts'));
        $adminApi = file_get_contents(base_path('frontend/src/api/adminAi.ts'));

        $this->assertStringContainsString('adapter.cancelTurn(target, turnId)', $store);
        $this->assertStringContainsString('ai/agent/turns/${turnId}/cancel', $api);
        $this->assertStringContainsString('ai/agent/turns/${turnId}/cancel', $adminApi);

        // Both surfaces, or the admin assistant keeps the old behaviour while
        // the customer one is fixed.
        $this->assertStringContainsString('cancelTurn: (uuid, turnId) => cancelAgentTurn(uuid, turnId)', $store);
        $this->assertStringContainsString('cancelTurn: (_target, turnId) => cancelAdminAgentTurn(turnId)', $store);

        // A queued turn has no turn id and nothing has run, so stopping it is
        // handing the place back rather than cancelling anything.
        $this->assertStringContainsString('adapter.releaseQueue(target, ticket)', $store);

        // The terminal state comes from the backend, because a tool already in
        // flight always finishes — the client cannot know what actually ran.
        $cancel = strpos($store, 'cancel: () => {');
        $this->assertIsInt($cancel);
        $this->assertStringContainsString('void reconcile(turnId, generation)', substr($store, $cancel));
    }

    /**
     * A queued turn comes back for its place, and does so exactly once.
     *
     * The panel no longer holds a request open while a turn waits for a slot,
     * so retrying is the client's job. The hazard is the retry replaying more
     * than the request: the user's message is appended to the transcript by
     * `send`, and an attempt that re-appended it would grow a duplicate on
     * every poll of a busy queue.
     */
    public function testAQueuedTurnRepresentsItsTicketWithoutReplayingTheTranscript(): void
    {
        $store = file_get_contents(base_path('frontend/src/state/agentChat.ts'));

        $this->assertStringContainsString('ticket: queueTicket ?? undefined', $store);
        $this->assertStringContainsString('scheduleQueueRetry()', $store);
        $this->assertStringContainsString("if (event.reason === 'queued')", $store);

        // The message is appended before the attempt closure is defined, and
        // the closure is what the retry calls — so the append cannot repeat.
        $send = strpos($store, 'send: (query, consoleBuffer) => {');
        $this->assertIsInt($send);
        $body = substr($store, $send, 1800);
        $appended = strpos($body, "kind: 'user', key: nextKey()");
        $attempt = strpos($body, 'const attempt = () => {');
        $this->assertIsInt($appended);
        $this->assertIsInt($attempt);
        $this->assertLessThan($attempt, $appended);

        // The banner survives a retry rather than flickering to nothing.
        $this->assertStringContainsString('beginTurn(queueTicket !== null)', $store);
        $this->assertStringContainsString('keepQueue ? {} : { queue: null }', $store);
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

    /**
     * A terminal result is evidence even when its announcement was salvaged or
     * refused early enough that no pending/running row reached the browser.
     */
    public function testAnUnmatchedToolResultSynthesizesATerminalEvidenceRow(): void
    {
        $store = file_get_contents(base_path('frontend/src/state/agentChat.ts'));
        $start = strpos($store, "case 'tool_result':");
        $end = strpos($store, "case 'approval_required':", $start);

        $this->assertIsInt($start);
        $this->assertIsInt($end);
        $resultHandler = substr($store, $start, $end - $start);

        $this->assertStringContainsString('matching !== -1', $resultHandler);
        $this->assertStringContainsString("kind: 'tool' as const", $resultHandler);
        $this->assertStringContainsString('callId: event.id', $resultHandler);
        $this->assertStringContainsString('tool: event.tool', $resultHandler);
        $this->assertStringContainsString('args: {}', $resultHandler);
        $this->assertStringContainsString("risk: 'safe' as const", $resultHandler);
        $this->assertStringContainsString("event.outcome === 'partial' ? 'partial' : event.ok ? 'ok' : 'error'", $resultHandler);
        $this->assertStringContainsString('summary: event.summary', $resultHandler);
        $this->assertStringContainsString('result: event.result', $resultHandler);
        $this->assertStringContainsString('durationMs: event.duration_ms', $resultHandler);
        $this->assertStringContainsString('batchParentCallId: event.batch_parent_id', $resultHandler);
        $this->assertStringContainsString('batchIndex: event.batch_index', $resultHandler);
    }

    /**
     * Naming a write is an intention, not evidence that the file changed.
     *
     * A tool row exists from tool_pending onward, before its arguments, policy
     * checks, live-file attestation and execution have completed. Its label must
     * therefore follow the event-backed status and reserve the past tense for
     * the successful tool_result state.
     */
    public function testFileWriteRowsClaimCompletionOnlyAfterASuccessfulResult(): void
    {
        $meta = file_get_contents(base_path('frontend/src/components/ai/toolMeta.tsx'));
        $row = file_get_contents(base_path('frontend/src/components/ai/ToolCallRow.tsx'));
        $messages = json_decode(file_get_contents(base_path('frontend/messages/en.json')), true);

        $this->assertStringContainsString('toolLifecycleLabel(entry.tool, entry.status)', $row);
        $this->assertStringContainsString("case 'pending':", $meta);
        $this->assertStringContainsString("case 'running':", $meta);
        $this->assertStringContainsString("case 'ok':", $meta);
        $this->assertStringContainsString("case 'partial':", $meta);
        $this->assertStringContainsString("case 'error':", $meta);

        $this->assertSame('Write file', $messages['server.ai.tools.files_write']);
        $this->assertSame('Preparing file write', $messages['server.ai.tools.files_write.pending']);
        $this->assertSame('Attempting file write', $messages['server.ai.tools.files_write.running']);
        $this->assertSame('Wrote', $messages['server.ai.tools.files_write.ok']);
        $this->assertSame('File write incomplete', $messages['server.ai.tools.files_write.partial']);
        $this->assertSame('File write failed', $messages['server.ai.tools.files_write.error']);
    }
}
