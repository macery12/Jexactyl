<?php

namespace Everest\Tests\Integration\Api\Client\Server;

use Everest\Models\AiMessage;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Agent\AssistBinding;
use Everest\Services\AI\Agent\ApprovalPreview;
use Everest\Services\AI\Data\AiMessage as MessageData;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;
use Everest\Http\Controllers\Api\Application\AiAgentController;
use Everest\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

/**
 * Turn persistence.
 *
 * A transcript that drops the tool steps reads as though the assistant answered
 * out of thin air, which is exactly the impression the agent must not give — so
 * what is written here is what the reloaded conversation shows.
 */
class AgentTranscriptTest extends ClientApiIntegrationTestCase
{
    private TurnRecorder $recorder;

    public function setUp(): void
    {
        parent::setUp();

        $this->recorder = $this->app->make(TurnRecorder::class);
    }

    public function testATurnOpensItsOwnConversationTitledFromTheQuestion(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $conversation = $this->recorder->ensureConversation(
            $user,
            $server,
            null,
            'Help me   disable dragons in  the Ice and Fire config',
        );

        $this->assertNotNull($conversation);
        // Whitespace is collapsed so a pasted multi-line question does not
        // become an unreadable rail entry.
        $this->assertSame('Help me disable dragons in the Ice and Fire config', $conversation->title);
        $this->assertSame($user->id, $conversation->user_id);
        $this->assertSame($server->uuid, $conversation->server_uuid);
        $this->assertNotNull($conversation->expires_at);
    }

    public function testAnExistingConversationIsReusedAndOneFromAnotherUserIsNot(): void
    {
        [$user, $server] = $this->generateTestAccount();
        [$other, $otherServer] = $this->generateTestAccount();

        $mine = $this->recorder->ensureConversation($user, $server, null, 'first');
        $again = $this->recorder->ensureConversation($user, $server, $mine->id, 'second');

        $this->assertSame($mine->id, $again->id);
        $this->assertSame('first', $again->title, 'Reusing a conversation must not retitle it.');

        $theirs = $this->recorder->ensureConversation($other, $otherServer, null, 'theirs');

        // Naming somebody else's conversation must not attach this turn to it.
        $escaped = $this->recorder->ensureConversation($user, $server, $theirs->id, 'attempt');

        $this->assertNotSame($theirs->id, $escaped->id);
        $this->assertSame($user->id, $escaped->user_id);
    }

    public function testAWholeTurnIsRecordedInOrderWithItsToolSteps(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $conversation = $this->recorder->ensureConversation($user, $server, null, 'disable dragons');

        $context = (new AgentContext($user, $server, 'turn-uuid', $conversation->id))
            ->withRecorder($this->recorder);

        $context->push(MessageData::user('disable dragons'));

        $context->step = 1;
        $call = new ToolCallData('call-1', 'files_read', ['file' => '/config/iceandfire.toml']);
        $context->push(MessageData::assistant(null, [$call]));
        $context->push(
            MessageData::tool('call-1', 'files_read', '{"ok":true,"result":{"huge":"payload"}}'),
            TurnRecorder::toolDisplay(true, '4.1 KB'),
        );

        $context->step = 2;
        $context->push(MessageData::assistant('Dragons are now disabled.'));

        $rows = AiMessage::where('conversation_id', $conversation->id)->orderBy('id')->get();

        $this->assertCount(4, $rows);
        $this->assertSame(['user', 'assistant', 'tool', 'assistant'], $rows->pluck('role')->all());

        // The assistant row carries the arguments the tool row renders from.
        $this->assertSame('files_read', $rows[1]->tool_calls[0]['name']);
        $this->assertSame('/config/iceandfire.toml', $rows[1]->tool_calls[0]['arguments']['file']);
        $this->assertSame(1, $rows[1]->step);

        // The tool row stores the compact card payload, not the model's copy.
        $this->assertSame('call-1', $rows[2]->tool_call_id);
        $this->assertSame('files_read', $rows[2]->tool_name);
        $this->assertSame(['ok' => true, 'summary' => '4.1 KB'], json_decode($rows[2]->content, true));
        $this->assertStringNotContainsString('huge', $rows[2]->content);
    }

    public function testReplayedHistoryCarriesProseButNotStaleToolResults(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $conversation = $this->recorder->ensureConversation($user, $server, null, 'first question');

        $context = (new AgentContext($user, $server, 'turn-1', $conversation->id))
            ->withRecorder($this->recorder);

        $context->push(MessageData::user('first question'));
        $context->push(MessageData::assistant(null, [new ToolCallData('c1', 'files_list', ['directory' => '/'])]));
        $context->push(
            MessageData::tool('c1', 'files_list', '{"ok":true}'),
            TurnRecorder::toolDisplay(true, '12 items'),
        );
        $context->push(MessageData::assistant('There are twelve files.'));

        $history = $this->recorder->loadHistory($conversation->id);

        // A previous turn's tool results describe a server state that has since
        // moved on; what the assistant concluded from them is what still holds.
        $this->assertCount(2, $history);
        $this->assertSame('user', $history[0]->role);
        $this->assertSame('first question', $history[0]->content);
        $this->assertSame('assistant', $history[1]->role);
        $this->assertSame('There are twelve files.', $history[1]->content);
    }

    public function testRecordingIsSkippedWithoutAConversationAndNeverThrows(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $context = (new AgentContext($user, $server, 'turn-2', null))->withRecorder($this->recorder);

        $context->push(MessageData::user('no conversation to write to'));

        // Losing a transcript must never cost the user their turn.
        $this->assertSame(0, AiMessage::count());
        $this->assertCount(1, $context->messages);
    }

    public function testTheConversationEndpointReturnsToolStepsForTheTranscript(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $conversation = $this->recorder->ensureConversation($user, $server, null, 'transcript');

        $context = (new AgentContext($user, $server, 'turn-3', $conversation->id))
            ->withRecorder($this->recorder);
        $context->step = 1;
        $context->push(MessageData::user('transcript'));
        $context->push(MessageData::assistant(null, [new ToolCallData('c9', 'files_write', ['file' => '/a.txt'])]));
        $context->push(
            MessageData::tool('c9', 'files_write', '{"ok":true}'),
            TurnRecorder::toolDisplay(true, '+2 / -1 lines'),
        );

        $response = $this->actingAs($user)
            ->getJson("/api/client/servers/{$server->uuid}/ai/conversations/{$conversation->id}");

        $response->assertOk();

        $messages = $response->json('data.messages');

        $this->assertCount(3, $messages);
        $this->assertSame('files_write', $messages[1]['tool_calls'][0]['name']);
        $this->assertSame('c9', $messages[2]['tool_call_id']);
        $this->assertSame('files_write', $messages[2]['tool_name']);
    }

    public function testUnsavedConversationsArePrunedToTheCap(): void
    {
        [$user, $server] = $this->generateTestAccount();

        for ($i = 0; $i < AiConversation::MAX_UNSAVED_PER_USER + 3; ++$i) {
            $this->recorder->ensureConversation($user, $server, null, 'chat ' . $i);
        }

        $this->assertLessThanOrEqual(
            AiConversation::MAX_UNSAVED_PER_USER,
            AiConversation::where('user_id', $user->id)->where('is_saved', false)->count(),
        );
    }

    public function testResumingASuspendedTurnDoesNotRewriteItsEarlierHalf(): void
    {
        [$user, $server] = $this->generateTestAccount();

        $conversation = $this->recorder->ensureConversation($user, $server, null, 'back this up');

        $context = (new AgentContext($user, $server, 'turn-4', $conversation->id))
            ->withRecorder($this->recorder);
        $context->push(MessageData::user('back this up'));
        $context->push(MessageData::assistant(null, [new ToolCallData('c1', 'backup_create', [])]));

        $this->assertSame(2, AiMessage::where('conversation_id', $conversation->id)->count());

        $state = $context->toState();

        // The approval arrives on a fresh request; the turn is rebuilt from
        // stored state, and the recorder is attached only afterwards. Attaching
        // it must not flush what is already there — that is the whole reason
        // resuming does not duplicate the turn's first half.
        $resumed = AgentContext::fromState($user, $server, 'turn-4', $conversation->id, $state)
            ->withRecorder($this->recorder);

        $this->assertCount(2, $resumed->messages, 'Both messages should be replayed into the model.');
        $this->assertSame(
            2,
            AiMessage::where('conversation_id', $conversation->id)->count(),
            'Attaching a recorder must record from that point on, not backfill.',
        );

        $resumed->push(
            MessageData::tool('c1', 'backup_create', '{"ok":true}'),
            TurnRecorder::toolDisplay(true, 'Created'),
        );

        $this->assertSame(3, AiMessage::where('conversation_id', $conversation->id)->count());
    }

    public function testApprovedAdminAssistAndRedactionsAreBankedForTheNextTurn(): void
    {
        [$admin, $server] = $this->generateTestAccount();
        $conversation = $this->recorder->ensureConversation($admin, null, null, 'Investigate customer server');

        $opened = new AgentContext($admin, null, 'turn-open', $conversation->id);
        $binding = new AssistBinding(
            serverUuid: $server->uuid,
            serverName: (string) $server->name,
            reason: 'Ticketed startup failure',
            ticketId: 42,
        );
        $opened->bindAssist($binding, $server);
        $token = $opened->redactions->tokenFor('email', 'customer@example.test');

        // This is the stream-completion operation used after approval. Passing
        // the resolved conversation is what was previously missing on admin
        // resumes.
        $this->recorder->touch($conversation, $opened);

        $next = new AgentContext($admin, null, 'turn-next', $conversation->id);
        $next->assist = $this->recorder->loadAssist($conversation->fresh());
        $next->redactions = $this->recorder->loadRedactions($conversation->fresh());

        $this->assertSame($server->uuid, $next->assist?->serverUuid);
        $this->assertFalse($next->assist?->writable);
        $this->assertSame('customer@example.test', $next->redactions->all()[$token]);
        $this->assertTrue($conversation->fresh()->expires_at->isFuture());

        $escalated = new AgentContext($admin, null, 'turn-escalate', $conversation->id);
        $escalated->redactions = $next->redactions;
        $escalated->bindAssist($next->assist->escalated(), $server);
        $this->recorder->touch($conversation->fresh(), $escalated);

        $following = $this->recorder->loadAssist($conversation->fresh());
        $this->assertSame($server->uuid, $following?->serverUuid);
        $this->assertTrue($following?->writable);
        $this->assertSame(AssistBinding::WRITE_ABILITIES, array_values(array_intersect(
            AssistBinding::WRITE_ABILITIES,
            $following?->abilities ?? [],
        )));
    }

    public function testAdminResumeConversationIsResolvedByOwnerAndScope(): void
    {
        [$admin] = $this->generateTestAccount();
        [$other] = $this->generateTestAccount();
        $conversation = $this->recorder->ensureConversation($admin, null, null, 'Admin assist');
        $pending = new AiPendingAction(['conversation_id' => $conversation->id]);

        $controller = (new \ReflectionClass(AiAgentController::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod(AiAgentController::class, 'pendingConversation');

        $this->assertSame($conversation->id, $method->invoke($controller, $pending, $admin->id)->id);

        try {
            $method->invoke($controller, $pending, $other->id);
            $this->fail('Another administrator must not bank state into this conversation.');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $this->assertSame(409, $e->getStatusCode());
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Pending approvals — what the user comes back to
    |--------------------------------------------------------------------------
    */

    public function testPendingActionsAreScopedToTheUserTheServerAndTheExpiryWindow(): void
    {
        [$user, $server] = $this->generateTestAccount();
        [$other, $otherServer] = $this->generateTestAccount();

        $mine = $this->pendingAction($user, $server, 'files_write');
        $this->pendingAction($other, $otherServer, 'files_delete');
        $this->pendingAction($user, $server, 'backup_delete', ['expires_at' => now()->subMinute()]);
        $this->pendingAction($user, $server, 'server_power', ['status' => 'approved']);

        $response = $this->actingAs($user)->getJson("/api/client/servers/{$server->uuid}/ai/agent/pending");

        $response->assertOk();
        $data = $response->json('data');

        // Only the one that is this user's, on this server, still pending, and
        // not yet expired.
        $this->assertCount(1, $data);
        $this->assertSame($mine->turn_id, $data[0]['turn_id']);
        $this->assertSame('files_write', $data[0]['tool']);
        $this->assertSame('diff', $data[0]['preview']['kind']);
        $this->assertNotNull($data[0]['expires_at']);
    }

    public function testAnotherUsersPendingActionIsNotVisibleOnTheirServerEither(): void
    {
        [$user] = $this->generateTestAccount();
        [$other, $otherServer] = $this->generateTestAccount();

        $this->pendingAction($other, $otherServer, 'files_delete');

        // Reaching the endpoint at all requires access to the server, so this
        // 404s on the server binding before the query is ever reached.
        $this->actingAs($user)
            ->getJson("/api/client/servers/{$otherServer->uuid}/ai/agent/pending")
            ->assertNotFound();
    }

    private function pendingAction($user, $server, string $tool, array $overrides = []): AiPendingAction
    {
        return AiPendingAction::create(array_merge([
            'turn_id' => \Illuminate\Support\Str::uuid()->toString(),
            'conversation_id' => $this->recorder->ensureConversation($user, $server, null, $tool)->id,
            'user_id' => $user->id,
            'server_uuid' => $server->uuid,
            'tool_name' => $tool,
            'risk' => 'write',
            'arguments' => ['file' => '/a.txt', 'original_content' => "a\n", 'content' => "b\n"],
            'state' => ['messages' => []],
            'step' => 1,
            'status' => 'pending',
            'expires_at' => now()->addMinutes(30),
        ], $overrides));
    }

    /*
    |--------------------------------------------------------------------------
    | Approval previews
    |--------------------------------------------------------------------------
    */

    public function testTheDiffPreviewIsRebuildableFromStoredArgumentsAlone(): void
    {
        // A pending action outlives the turn that created it, so the card the
        // user comes back to has only the tool name and arguments to work from.
        $preview = ApprovalPreview::for('files_write', [
            'file' => '/config/iceandfire.toml',
            'original_content' => "spawn_dragons = true\n",
            'content' => "spawn_dragons = false\n",
        ]);

        $this->assertSame('diff', $preview['kind']);
        $this->assertSame('/config/iceandfire.toml', $preview['file']);
        $this->assertSame("spawn_dragons = true\n", $preview['original']);
        $this->assertSame("spawn_dragons = false\n", $preview['updated']);

        $this->assertNull(ApprovalPreview::for('backup_restore', ['backup' => 'abc']));
    }

    /**
     * The one argument on an assist approval that nobody can weigh.
     *
     * An administrator is being asked to enter a paying customer's server, and
     * the model names it with whatever identifier it happened to read off a
     * listing — `"2"`, a uuid, a short uuid. None of those are a thing a person
     * can consent to, so the preview resolves the reference once into the name
     * and owner the decision is actually about.
     */
    public function testTheAssistPreviewNamesTheServerRatherThanItsIdentifier(): void
    {
        [$user, $server] = $this->generateTestAccount();

        foreach ([(string) $server->id, $server->uuid, $server->uuidShort] as $reference) {
            $preview = ApprovalPreview::for('admin_assist_server', [
                'server' => $reference,
                'reason' => 'The owner reported a crash loop after a mod update.',
            ]);

            $this->assertSame('server', $preview['kind'], sprintf('%s should resolve.', $reference));
            $this->assertSame($server->name, $preview['name']);
            $this->assertSame($user->username, $preview['owner']);
            $this->assertSame($server->uuidShort, $preview['identifier']);
        }

        // A reference that resolves to nothing falls back to showing the raw
        // argument rather than inventing a server, and the call itself still
        // fails the way it always did.
        $this->assertNull(ApprovalPreview::for('admin_assist_server', ['server' => '99999999']));
        $this->assertNull(ApprovalPreview::for('admin_assist_server', ['reason' => 'no server named']));
    }

    /*
    |--------------------------------------------------------------------------
    | Result summaries — the only outcome text the user ever sees
    |--------------------------------------------------------------------------
    */

    public function testSummariesDescribeTheOutcomeRatherThanJustSucceeding(): void
    {
        $this->assertSame('12 items', ToolResult::ok(['items' => range(1, 12), 'count' => 12])->summary());
        $this->assertSame('1 item', ToolResult::ok(['items' => ['a'], 'count' => 1])->summary());
        $this->assertSame(
            '250 items (showing 2)',
            ToolResult::ok(['items' => ['a', 'b'], 'count' => 250])->summary(),
        );
        $this->assertSame('+4 / -2 lines', ToolResult::ok(['written' => true, 'additions' => 4, 'deletions' => 2])->summary());
        $this->assertSame('Sent', ToolResult::ok(['sent' => true])->summary());
        $this->assertSame('Read (truncated)', ToolResult::ok('a long file', truncated: true)->summary());
        $this->assertSame(
            'forbidden: You lack permission.',
            ToolResult::error('forbidden', 'You lack permission.', 403)->summary(),
        );
    }
}
