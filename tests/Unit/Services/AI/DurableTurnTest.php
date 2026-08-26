<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\AiTurnEvent;
use Everest\Models\UserSession;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentEventLog;
use Everest\Services\AI\Agent\TurnAuthority;
use Everest\Services\AI\Inference\TurnLease;
use Everest\Services\AI\Agent\WorkerRequestScope;
use Illuminate\Foundation\Testing\RefreshDatabase;

/**
 * The parts of durable execution that are load-bearing rather than plumbing.
 *
 * Three properties are asserted here because all three are the kind that fail
 * silently: a replay that carries more than a reload would, an authority that
 * outlives the session behind it, and a lease released by the wrong owner.
 */
class DurableTurnTest extends TestCase
{
    use RefreshDatabase;

    private AgentEventLog $log;

    public function setUp(): void
    {
        parent::setUp();

        $this->log = app(AgentEventLog::class);
    }

    /*
    |--------------------------------------------------------------------------
    | The event log
    |--------------------------------------------------------------------------
    */

    public function testFramesReplayInOrderFromACursor(): void
    {
        $turn = $this->turnId();

        $this->log->append($turn, AgentEvent::text('one'));
        $this->log->append($turn, AgentEvent::text('two'));
        $this->log->append($turn, AgentEvent::text('three'));

        $all = $this->log->replay($turn);
        $this->assertSame([1, 2, 3], array_column($all, 'seq'));
        $this->assertSame('one', $all[0]['event']['content']);

        $resumed = $this->log->replay($turn, 2);
        $this->assertCount(1, $resumed);
        $this->assertSame('three', $resumed[0]['event']['content']);
    }

    /**
     * A resumed turn re-enters under the same id in a different worker. If the
     * counter restarted the unique index would reject every frame of the second
     * leg, and the turn would run with an unreadable tail.
     */
    public function testSequenceContinuesAcrossProcesses(): void
    {
        $turn = $this->turnId();

        $this->log->append($turn, AgentEvent::text('first leg'));

        // A different instance is a different process for this purpose: the
        // in-memory counter is gone and only the stored maximum remains.
        $second = new AgentEventLog();
        $second->append($turn, AgentEvent::text('second leg'));

        $this->assertSame([1, 2], array_column($this->log->replay($turn), 'seq'));
        $this->assertSame(2, $this->log->latestSequence($turn));
    }

    /**
     * The shaped payload the model was handed is live-only by existing policy —
     * a reloaded transcript has never contained it. A replay that carried it
     * would create exactly the larger second copy that policy prevents.
     */
    public function testShapedToolPayloadIsNeverPersisted(): void
    {
        $turn = $this->turnId();

        $this->log->append($turn, AgentEvent::toolResult(
            id: 'call_1',
            tool: 'list_files',
            ok: true,
            summary: 'Listed 3 files',
            result: ['secret' => 'do-not-store-me'],
        ));

        $stored = AiTurnEvent::where('turn_id', $turn)->firstOrFail();

        $this->assertArrayNotHasKey('result', $stored->payload);
        $this->assertSame('Listed 3 files', $stored->payload['summary']);
        $this->assertStringNotContainsString('do-not-store-me', (string) json_encode($stored->payload));
    }

    /** A ticket is a bearer credential for a queue place; replaying one gives it away. */
    public function testQueueTicketIsNeverPersisted(): void
    {
        $turn = $this->turnId();

        $this->log->append($turn, AgentEvent::queued(2, 1, 30, 'ticket-abc', 1000));

        $stored = AiTurnEvent::where('turn_id', $turn)->firstOrFail();

        $this->assertArrayNotHasKey('ticket', $stored->payload);
        $this->assertSame(2, $stored->payload['position']);
    }

    /*
    |--------------------------------------------------------------------------
    | Authority
    |--------------------------------------------------------------------------
    */

    public function testAuthorityHoldsWhileTheSessionIsLive(): void
    {
        $user = User::factory()->create();
        $this->trackedSession($user, 'session-live');

        $this->assertTrue($this->authority($user, 'session-live')->stillHeld());
    }

    public function testRevokingTheSessionWithdrawsAuthority(): void
    {
        $user = User::factory()->create();
        $session = $this->trackedSession($user, 'session-revoked');

        $this->assertTrue($this->authority($user, 'session-revoked')->stillHeld());

        $session->update(['revoked_at' => now()]);

        $this->assertFalse($this->authority($user, 'session-revoked')->stillHeld());
    }

    /** Signing out deletes the tracking row rather than revoking it. */
    public function testSigningOutWithdrawsAuthority(): void
    {
        $user = User::factory()->create();
        $this->trackedSession($user, 'session-gone')->delete();

        $this->assertFalse($this->authority($user, 'session-gone')->stillHeld());
    }

    public function testSuspendingTheAccountWithdrawsAuthority(): void
    {
        $user = User::factory()->create();
        $this->trackedSession($user, 'session-suspend');

        $user->update(['state' => 'suspended']);

        $this->assertFalse($this->authority($user, 'session-suspend')->stillHeld());
    }

    public function testDeletingTheAccountWithdrawsAuthority(): void
    {
        $user = User::factory()->create();
        $authority = $this->authority($user, null);

        $user->delete();

        $this->assertNull($authority->user());
        $this->assertFalse($authority->stillHeld());
    }

    public function testALegacySessionlessTurnWithoutAKeyIdFailsClosed(): void
    {
        $user = User::factory()->create();

        $this->assertFalse($this->authority($user, null)->stillHeld());
    }

    public function testDeletingTheOriginatingApiKeyWithdrawsAuthority(): void
    {
        $user = User::factory()->create();
        $key = $this->apiKey($user);
        $authority = $this->keyAuthority($user, $key);

        $this->assertTrue($authority->stillHeld());

        $key->delete();

        $this->assertFalse($authority->stillHeld());
    }

    public function testCaptureAndQueueRoundTripRetainApiKeyIdentity(): void
    {
        $user = User::factory()->create();
        $key = $this->apiKey($user);
        $user->withAccessToken($key);
        $request = Request::create('https://panel.test/api/client/servers/server/ai/agent', 'POST');

        $captured = TurnAuthority::capture($request, $user);
        $restored = TurnAuthority::fromArray($captured->toArray());

        $this->assertSame($key->id, $captured->apiKeyId);
        $this->assertSame($key->id, $restored->apiKeyId);
        $this->assertTrue($restored->stillHeld());
    }

    public function testExpiredApiKeyWithdrawsAuthority(): void
    {
        $user = User::factory()->create();
        $key = $this->apiKey($user, ['expires_at' => now()->subMinute()]);

        $this->assertFalse($this->keyAuthority($user, $key)->stillHeld());
    }

    public function testApiKeyIpAllowlistIsRechecked(): void
    {
        $user = User::factory()->create();
        $key = $this->apiKey($user, ['allowed_ips' => ['10.20.30.0/24']]);

        $allowed = new TurnAuthority($user->id, null, '10.20.30.40', 'https://panel.test', $key->id);
        $denied = new TurnAuthority($user->id, null, '10.20.31.40', 'https://panel.test', $key->id);

        $this->assertTrue($allowed->stillHeld());
        $this->assertFalse($denied->stillHeld());
    }

    public function testWorkerScopePreservesTheOriginatingApiKey(): void
    {
        $user = User::factory()->create();
        $key = $this->apiKey($user);
        $authority = $this->keyAuthority($user, $key);

        app(WorkerRequestScope::class)->during($authority, $user, function (User $scoped) use ($key): void {
            $this->assertInstanceOf(ApiKey::class, $scoped->currentAccessToken());
            $this->assertSame($key->id, $scoped->currentAccessToken()->id);
        });
    }

    /*
    |--------------------------------------------------------------------------
    | The boundary check that acts on a withdrawn authority
    |--------------------------------------------------------------------------
    */

    /**
     * A withdrawn authority stops the turn through the *same* path a user's Stop
     * does, which is what makes it safe: nothing is half-done at a boundary, and
     * the calls the stop left unrun still get answered so the transcript stays
     * one a provider will accept.
     */
    public function testAWithdrawnAuthorityStopsTheTurnAtTheBoundary(): void
    {
        $context = $this->context();
        $context->authorityCheck = fn (): bool => false;

        $this->assertTrue($this->stopRequested($context));
        $this->assertTrue($context->cancelled);

        // Reported apart from a user-initiated stop, because "you stopped this"
        // and "your session ended" are different facts about the same transcript.
        $this->assertTrue($context->revoked);
    }

    public function testAHeldAuthorityDoesNotStopTheTurn(): void
    {
        $context = $this->context();
        $context->authorityCheck = fn (): bool => true;

        $this->assertFalse($this->stopRequested($context));
        $this->assertFalse($context->cancelled);
        $this->assertFalse($context->revoked);
    }

    /** A request-bound turn cannot outlive its session, so it carries no check. */
    public function testATurnWithoutAnAuthorityCheckIsNeverRevoked(): void
    {
        $context = $this->context();

        $this->assertFalse($this->stopRequested($context));
        $this->assertFalse($context->revoked);
    }

    /**
     * `stopRequested()` is called between steps, before each call in a
     * multi-call response, and between the children of a batch. Asking the
     * database at every one of those would put two queries between each child of
     * a twenty-call batch to answer a question that changes at human speed.
     */
    public function testTheAuthorityCheckIsRateLimitedWithinASingleTurn(): void
    {
        $calls = 0;
        $context = $this->context();
        $context->authorityCheck = function () use (&$calls): bool {
            ++$calls;

            return true;
        };

        $runner = app(\Everest\Services\AI\Agent\AgentRunner::class);

        foreach (range(1, 5) as $ignored) {
            $this->stopRequested($context, $runner);
        }

        $this->assertSame(1, $calls, 'The authority should be re-derived once per interval, not once per boundary.');
    }

    /*
    |--------------------------------------------------------------------------
    | Handing a held resource to another process
    |--------------------------------------------------------------------------
    */

    public function testALeaseHandleCarriesTheOwnerRatherThanTheLock(): void
    {
        $lock = Cache::lock('ai:test:handle-slot', 30);
        $this->assertTrue($lock->get());

        $lease = TurnLease::held(3, $lock, ['ownerKey' => 'user-1', 'token' => 'tok-1'], fn () => null);
        $handle = $lease->handle();

        $this->assertSame(3, $handle['slot']);
        $this->assertSame($lock->owner(), $handle['owner']);
        $this->assertSame('user-1', $handle['reservation']['ownerKey']);
    }

    public function testAPassthroughLeaseHandsOverNothing(): void
    {
        $this->assertNull(TurnLease::passthrough()->handle());
    }

    /**
     * The reason the worker may release a lease it never took: the owner token
     * qualifies it, so a lease that expired and was retaken belongs to somebody
     * else and a late release leaves the new holder alone.
     */
    public function testAnExpiredHandleCannotReleaseItsReplacement(): void
    {
        $original = Cache::lock('ai:test:handed-slot', 1);
        $this->assertTrue($original->get());
        $staleOwner = $original->owner();

        $this->travel(2)->seconds();

        $replacement = Cache::lock('ai:test:handed-slot', 30);
        $this->assertTrue($replacement->get());

        Cache::restoreLock('ai:test:handed-slot', $staleOwner)->release();

        // Still held by the replacement: a third party cannot take it.
        $this->assertFalse(Cache::lock('ai:test:handed-slot', 30)->get());
    }

    private function context(): \Everest\Services\AI\Agent\AgentContext
    {
        return new \Everest\Services\AI\Agent\AgentContext(
            user: User::factory()->create(),
            server: null,
            turnId: $this->turnId(),
        );
    }

    /** `stopRequested()` is the boundary itself, and is deliberately protected. */
    private function stopRequested(
        \Everest\Services\AI\Agent\AgentContext $context,
        ?\Everest\Services\AI\Agent\AgentRunner $runner = null,
    ): bool {
        $runner ??= app(\Everest\Services\AI\Agent\AgentRunner::class);

        $method = new \ReflectionMethod($runner, 'stopRequested');

        return (bool) $method->invoke($runner, $context);
    }

    private function authority(User $user, ?string $sessionId): TurnAuthority
    {
        return new TurnAuthority($user->id, $sessionId, '127.0.0.1', 'https://panel.test');
    }

    private function keyAuthority(User $user, ApiKey $key): TurnAuthority
    {
        return new TurnAuthority($user->id, null, '127.0.0.1', 'https://panel.test', $key->id);
    }

    /** @param array<string, mixed> $attributes */
    private function apiKey(User $user, array $attributes = []): ApiKey
    {
        return ApiKey::factory()->for($user)->create(array_merge([
            'key_type' => ApiKey::TYPE_ACCOUNT,
            'allowed_ips' => [],
        ], $attributes));
    }

    private function trackedSession(User $user, string $sessionId): UserSession
    {
        return UserSession::create([
            'user_id' => $user->id,
            'session_id' => $sessionId,
            'device_fingerprint' => 'fingerprint-' . $sessionId,
            'last_activity_at' => now(),
        ]);
    }

    private function turnId(): string
    {
        return (string) \Illuminate\Support\Str::uuid();
    }
}
