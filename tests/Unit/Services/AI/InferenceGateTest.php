<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Inference\TurnLease;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

/**
 * Admission control for self-hosted inference. The cache store under test is
 * the array driver, which supports the same atomic lock and counter primitives
 * the Redis store uses in production.
 *
 * The property most of this file exists to pin is that **nothing waits**. The
 * gate used to block in a sleep loop, which meant a queued turn held a PHP
 * worker for as long as it was queued — so the queue consumed the capacity it
 * was there to protect, and its depth had to be clamped against the deployment's
 * worker pool to stop it taking the panel down. A turn that cannot have a slot
 * now leaves with a ticket, and comes back for it.
 */
class InferenceGateTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        // The gate reads its limits through the settings repository; stub it so
        // these tests exercise the config defaults without touching a database.
        $this->app->bind(SettingsRepositoryInterface::class, fn () => new class () {
            public function get(string $key, mixed $default = null): mixed
            {
                return $default;
            }
        });

        Cache::flush();
    }

    private function gate(string $provider = ProviderConfig::PROVIDER_OLLAMA, array $config = []): InferenceGate
    {
        config()->set('modules.ai.provider', $provider);
        foreach ($config as $key => $value) {
            config()->set('modules.ai.' . $key, $value);
        }

        return new InferenceGate(new ProviderFactory());
    }

    /** A gate whose clock this test drives, for the ages a ticket is measured by. */
    private function clockedGate(array $config = []): InferenceGate
    {
        config()->set('modules.ai.provider', ProviderConfig::PROVIDER_OLLAMA);
        foreach ($config as $key => $value) {
            config()->set('modules.ai.' . $key, $value);
        }

        return new class (new ProviderFactory()) extends InferenceGate {
            public float $offset = 0.0;

            protected function now(): float
            {
                return microtime(true) + $this->offset;
            }
        };
    }

    public function testHostedProvidersSkipAdmissionControlEntirely(): void
    {
        $gate = $this->gate(ProviderConfig::PROVIDER_ANTHROPIC);

        $this->assertFalse($gate->applies());

        // Callers get the same lease shape either way so the turn code has no branch.
        $admission = $gate->admit('user-1');
        $this->assertTrue($admission->granted());
        $this->assertTrue($admission->lease->passthrough);
        $this->assertNull($admission->lease->slot);
        $this->assertNull($admission->ticket);
        $admission->lease->release();
    }

    public function testSelfHostedProvidersAreGated(): void
    {
        $this->assertTrue($this->gate(ProviderConfig::PROVIDER_OLLAMA)->applies());
        $this->assertTrue($this->gate(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE)->applies());
    }

    public function testGrantsUpToTheConfiguredSlotCount(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 2, 'concurrency.per_user' => 0]);

        $first = $gate->admit('user-1');
        $second = $gate->admit('user-2');

        $this->assertTrue($first->granted());
        $this->assertTrue($second->granted());
        $this->assertNotSame($first->lease->slot, $second->lease->slot);
        $this->assertSame(2, $gate->slotsInUse());

        $first->lease->release();
        $this->assertSame(1, $gate->slotsInUse());

        $second->lease->release();
        $this->assertSame(0, $gate->slotsInUse());
    }

    /**
     * The whole point of the rewrite: a busy gate answers immediately.
     *
     * The old gate sat in `usleep()` until either a slot freed or the configured
     * wait elapsed — up to two minutes of a PHP worker doing nothing. Timing an
     * assertion is usually a smell, but here the elapsed time *is* the property.
     */
    public function testABusyGateReturnsATicketInsteadOfBlocking(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.max_wait_seconds' => 120,
        ]);

        $held = $gate->admit('user-1');
        $startedAt = microtime(true);

        $queued = $gate->admit('user-2');

        $this->assertLessThan(1.0, microtime(true) - $startedAt);
        $this->assertFalse($queued->granted());
        $this->assertNull($queued->lease);
        $this->assertNotNull($queued->ticket);
        $this->assertSame(1, $queued->position);
        $this->assertSame(0, $queued->ahead);
        $this->assertGreaterThan(0, $queued->etaSeconds);
        $this->assertGreaterThan(0, $queued->retryAfterMs);

        $held->lease->release();
    }

    public function testPresentingATicketKeepsThePlaceAndIsAdmittedWhenASlotFrees(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 0]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');
        $this->assertFalse($queued->granted());

        // Coming back while the slot is still busy holds the same place rather
        // than issuing a fresh ticket at the back of the queue.
        $again = $gate->admit('user-2', InferenceGate::LANE_NEW, $queued->ticket);
        $this->assertFalse($again->granted());
        $this->assertSame($queued->ticket, $again->ticket);
        $this->assertSame(1, $gate->queueDepth());

        $held->lease->release();

        $admitted = $gate->admit('user-2', InferenceGate::LANE_NEW, $queued->ticket);
        $this->assertTrue($admitted->granted());
        $this->assertSame(0, $gate->queueDepth(), 'A granted ticket leaves the queue.');

        $admitted->lease->release();
    }

    public function testANewArrivalDoesNotOvertakeAWaitingTicket(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 0]);

        $held = $gate->admit('user-1');
        $first = $gate->admit('user-2');
        $this->assertFalse($first->granted());

        $held->lease->release();

        // The slot is free, but it is not this caller's turn: position has to
        // mean something, or the user who arrived first watches later ones
        // overtake them for as long as the panel is busy.
        $second = $gate->admit('user-3');
        $this->assertFalse($second->granted());
        $this->assertSame(1, $second->ahead);

        $admitted = $gate->admit('user-2', InferenceGate::LANE_NEW, $first->ticket);
        $this->assertTrue($admitted->granted());
        $admitted->lease->release();
    }

    public function testResumesOutrankNewTurnsRegardlessOfArrivalOrder(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 0]);

        $held = $gate->admit('user-1');
        $newcomer = $gate->admit('user-2', InferenceGate::LANE_NEW);
        $resume = $gate->admit('user-3', InferenceGate::LANE_RESUME);

        $this->assertFalse($newcomer->granted());
        $this->assertFalse($resume->granted());

        // A half-finished turn a user is actively waiting on takes priority:
        // finishing it is what returns VRAM to the pool. The resume arrived
        // second and is still in front.
        $this->assertSame(0, $resume->ahead);

        $held->lease->release();

        // Position is answered per attempt rather than pushed, so the newcomer
        // learns it has been overtaken when it next comes back — which is also
        // the moment the answer could matter to it.
        $stillWaiting = $gate->admit('user-2', InferenceGate::LANE_NEW, $newcomer->ticket);
        $this->assertFalse($stillWaiting->granted(), 'The resume is ahead and the only slot is its.');
        $this->assertSame(1, $stillWaiting->ahead);

        $admitted = $gate->admit('user-3', InferenceGate::LANE_RESUME, $resume->ticket);
        $this->assertTrue($admitted->granted());
        $admitted->lease->release();
    }

    public function testRefusesImmediatelyWhenTheQueueIsFull(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.queue_depth' => 1,
        ]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');
        $this->assertFalse($queued->granted());

        try {
            $gate->admit('user-3');
            $this->fail('Expected the gate to refuse a full queue.');
        } catch (AIServiceException $e) {
            // Refusing fast is kinder than an unbounded queue nobody reaches
            // the front of — and the caller must not be charged for it.
            $this->assertStringContainsString('queue is full', $e->getMessage());
        }

        // The refused caller keeps nothing: no ticket, and no reservation that
        // would lock them out of retrying.
        $this->assertSame(1, $gate->queueDepth());
        $this->assertSame(0, $gate->activeForUser('user-3'));

        $held->lease->release();
    }

    public function testAQueueDepthOfZeroRefusesRatherThanQueues(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.queue_depth' => 0,
        ]);

        $held = $gate->admit('user-1');

        $this->expectException(AIServiceException::class);
        $this->expectExceptionMessage('queue is full');

        try {
            $gate->admit('user-2');
        } finally {
            $held->lease->release();
        }
    }

    public function testAQueuePlaceCountsAgainstThePerUserLimit(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 1]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');

        $this->assertFalse($queued->granted());
        $this->assertSame(1, $gate->activeForUser('user-2'));

        try {
            $gate->admit('user-2');
            $this->fail('A second request from a user already queued must be refused.');
        } catch (AIServiceException $e) {
            $this->assertStringContainsString('running or queued', $e->getMessage());
        }

        // Presenting the ticket is not a second request, and must not be read
        // as one — otherwise a queued user could never come back for their slot.
        $again = $gate->admit('user-2', InferenceGate::LANE_NEW, $queued->ticket);
        $this->assertFalse($again->granted());
        $this->assertSame(1, $gate->activeForUser('user-2'));

        $held->lease->release();
    }

    public function testGivingUpAQueuePlaceFreesItImmediately(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 1]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');

        $this->assertTrue($gate->releaseTicket($queued->ticket, 'user-2'));
        $this->assertSame(0, $gate->queueDepth());

        // The point of releasing rather than waiting for the idle timeout: the
        // user who pressed Stop can send their next message straight away.
        $this->assertSame(0, $gate->activeForUser('user-2'));

        $this->assertFalse($gate->releaseTicket($queued->ticket, 'user-2'), 'Releasing twice is a no-op.');

        $held->lease->release();
    }

    public function testATicketBelongingToSomebodyElseIsNotHonoured(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 0]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');

        $this->assertFalse($gate->releaseTicket($queued->ticket, 'user-3'));
        $this->assertSame(1, $gate->queueDepth(), 'Another user must not be able to drop this place.');

        try {
            $gate->admit('user-3', InferenceGate::LANE_NEW, $queued->ticket);
            $this->fail('A ticket must only be presentable by the owner it was issued to.');
        } catch (AIServiceException $e) {
            $this->assertStringContainsString('did not free up in time', $e->getMessage());
        }

        $held->lease->release();
    }

    public function testATicketNobodyComesBackForLapsesAndFreesItsReservation(): void
    {
        $gate = $this->clockedGate(['concurrency.slots' => 1, 'concurrency.per_user' => 1]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');
        $this->assertSame(1, $gate->activeForUser('user-2'));

        // A closed tab, a lost connection and a browser that navigated away are
        // the same event from here, and none of them will say so.
        $gate->offset = 60.0;

        $this->assertSame(0, $gate->queueDepth());

        try {
            $gate->admit('user-2', InferenceGate::LANE_NEW, $queued->ticket);
            $this->fail('A lapsed ticket must not be honoured.');
        } catch (AIServiceException $e) {
            $this->assertStringContainsString('did not free up in time', $e->getMessage());
        }

        $this->assertSame(0, $gate->activeForUser('user-2'), 'A lapsed place releases its reservation.');

        $held->lease->release();
    }

    public function testATicketHeldPastTheConfiguredWaitIsGivenUp(): void
    {
        $gate = $this->clockedGate([
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.max_wait_seconds' => 30,
        ]);

        $held = $gate->admit('user-1');
        $queued = $gate->admit('user-2');

        // Presented steadily, so it never goes idle — but the total wait is
        // still bounded, because at some point being told "not yet" forever is
        // worse than being told no.
        for ($tick = 1; $tick <= 3; ++$tick) {
            $gate->offset = $tick * 10.0;
            if ($tick < 3) {
                $again = $gate->admit('user-2', InferenceGate::LANE_NEW, $queued->ticket);
                $this->assertFalse($again->granted());

                continue;
            }

            try {
                $gate->admit('user-2', InferenceGate::LANE_NEW, $queued->ticket);
                $this->fail('A ticket older than the configured wait must be refused.');
            } catch (AIServiceException $e) {
                $this->assertStringContainsString('did not free up in time', $e->getMessage());
            }
        }

        $held->lease->release();
    }

    public function testAnExpiredOwnersCleanupCannotReleaseAReplacementReservation(): void
    {
        $gate = $this->gate(config: ['concurrency.per_user' => 1]);
        $reserve = new \ReflectionMethod(InferenceGate::class, 'reserveUser');
        $release = new \ReflectionMethod(InferenceGate::class, 'releaseUser');
        $old = $reserve->invoke($gate, 'user-replaced');

        // Simulate expiry/recovery followed by a new owner. The late finally
        // from the old worker must not decrement the replacement's count.
        Cache::forget('ai:reservation:user:' . $old['token']);
        Cache::put('ai:active:user:user-replaced', 1, 60);
        $release->invoke($gate, $old);

        $this->assertSame(1, $gate->activeForUser('user-replaced'));
    }

    public function testAnExpiredSlotOwnerCannotReleaseItsReplacement(): void
    {
        $oldLock = Cache::lock('ai:test:owned-slot', 1);
        $this->assertTrue($oldLock->get());
        $oldLease = TurnLease::held(0, $oldLock, fn () => null);

        $this->travel(2)->seconds();
        $replacement = Cache::lock('ai:test:owned-slot', 30);
        $this->assertTrue($replacement->get());

        $oldLease->release();

        $contender = Cache::lock('ai:test:owned-slot', 30);
        $this->assertFalse($contender->get(), 'The old owner must not release the replacement lock.');
        $replacement->release();
    }

    public function testReleasingIsIdempotent(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 1]);

        $admission = $gate->admit('user-1');
        $admission->lease->release();
        $admission->lease->release();

        // A double release must not drive the per-user counter negative and
        // lock the user out of their next turn.
        $this->assertSame(0, $gate->activeForUser('user-1'));
        $this->assertSame(0, $gate->slotsInUse());

        $gate->admit('user-1')->lease->release();
    }

    public function testEtaTracksRecentTurnDurationsAndScalesWithSlots(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 2]);

        $gate->recordTurnDuration(10_000);
        $this->assertSame(10_000, $gate->averageTurnMs());

        // Later turns are smoothed rather than replacing the estimate outright.
        $gate->recordTurnDuration(20_000);
        $this->assertGreaterThan(10_000, $gate->averageTurnMs());
        $this->assertLessThan(20_000, $gate->averageTurnMs());

        // Two slots clear two waiters per batch, so one ahead is still one batch.
        $this->assertSame($gate->estimatedWaitSeconds(0), $gate->estimatedWaitSeconds(1));
        $this->assertGreaterThan($gate->estimatedWaitSeconds(1), $gate->estimatedWaitSeconds(2));
    }

    public function testStatsSnapshotReflectsLiveSlotAndQueueUsage(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 2, 'concurrency.per_user' => 0]);

        $first = $gate->admit('user-1');
        $second = $gate->admit('user-2');
        $queued = $gate->admit('user-3', InferenceGate::LANE_RESUME);
        $this->assertFalse($queued->granted());

        $stats = $gate->stats();

        $this->assertTrue($stats['applies']);
        $this->assertSame(2, $stats['slots']);
        $this->assertSame(2, $stats['slots_in_use']);
        $this->assertSame(1, $stats['queue_depth']);
        $this->assertSame(0, $stats['waiting_new']);
        $this->assertSame(1, $stats['waiting_resume']);

        $first->lease->release();
        $second->lease->release();

        $this->assertFalse($this->gate(ProviderConfig::PROVIDER_ANTHROPIC)->stats()['applies']);
    }
}
