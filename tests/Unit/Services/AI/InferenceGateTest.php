<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

/**
 * Admission control for self-hosted inference. The cache store under test is
 * the array driver, which supports the same atomic lock and counter primitives
 * the Redis store uses in production.
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

    public function testHostedProvidersSkipAdmissionControlEntirely(): void
    {
        $gate = $this->gate(ProviderConfig::PROVIDER_ANTHROPIC);

        $this->assertFalse($gate->applies());

        // Callers get the same lease shape either way so the turn code has no branch.
        $lease = $gate->acquire('user-1');
        $this->assertTrue($lease->passthrough);
        $this->assertNull($lease->slot);
        $lease->release();
    }

    public function testSelfHostedProvidersAreGated(): void
    {
        $this->assertTrue($this->gate(ProviderConfig::PROVIDER_OLLAMA)->applies());
        $this->assertTrue($this->gate(ProviderConfig::PROVIDER_OPENAI_COMPATIBLE)->applies());
    }

    public function testGrantsUpToTheConfiguredSlotCount(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 2, 'concurrency.per_user' => 0]);

        $first = $gate->acquire('user-1');
        $second = $gate->acquire('user-2');

        $this->assertFalse($first->passthrough);
        $this->assertNotSame($first->slot, $second->slot);
        $this->assertSame(2, $gate->slotsInUse());

        $first->release();
        $this->assertSame(1, $gate->slotsInUse());

        $second->release();
        $this->assertSame(0, $gate->slotsInUse());
    }

    public function testRefusesWhenEveryySlotIsBusyAndTheWaitElapses(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.max_wait_seconds' => 5,
        ]);

        $held = $gate->acquire('user-1');

        $this->expectException(AIServiceException::class);
        $this->expectExceptionMessage('did not free up in time');

        try {
            $gate->acquire('user-2');
        } finally {
            $held->release();
        }
    }

    public function testRefusesImmediatelyWhenTheQueueIsFull(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.queue_depth' => 1,
        ]);

        $held = $gate->acquire('user-1');

        // Simulate one waiter already queued.
        Cache::put('ai:waiting:new', 1, 60);

        $started = microtime(true);

        try {
            $gate->acquire('user-2');
            $this->fail('Expected the gate to refuse a full queue.');
        } catch (AIServiceException $e) {
            // Refusing fast is kinder than an unbounded queue nobody reaches
            // the front of — and the caller must not be charged for it.
            $this->assertStringContainsString('queue is full', $e->getMessage());
            $this->assertLessThan(1.0, microtime(true) - $started);
        } finally {
            $held->release();
        }
    }

    public function testOneUserCannotOccupyEverySlot(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 4, 'concurrency.per_user' => 1]);

        $first = $gate->acquire('user-1');

        try {
            $gate->acquire('user-1');
            $this->fail('Expected the per-user limit to reject a second concurrent turn.');
        } catch (AIServiceException $e) {
            $this->assertStringContainsString('already have an AI request running', $e->getMessage());
        }

        // A different user is unaffected.
        $other = $gate->acquire('user-2');
        $this->assertFalse($other->passthrough);

        $first->release();
        $other->release();

        $this->assertSame(0, $gate->activeForUser('user-1'));
    }

    public function testReleasingIsIdempotent(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 1]);

        $lease = $gate->acquire('user-1');
        $lease->release();
        $lease->release();

        // A double release must not drive the per-user counter negative and
        // lock the user out of their next turn.
        $this->assertSame(0, $gate->activeForUser('user-1'));
        $this->assertSame(0, $gate->slotsInUse());

        $gate->acquire('user-1')->release();
    }

    public function testNewTurnsStandDownWhileAResumeIsWaiting(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.max_wait_seconds' => 5,
        ]);

        // A resume is queued; the only slot is free.
        Cache::put('ai:waiting:' . InferenceGate::LANE_RESUME, 1, 60);

        $this->expectException(AIServiceException::class);

        // A half-finished turn the user is actively waiting on takes priority:
        // finishing it is what returns VRAM to the pool.
        $gate->acquire('user-2', InferenceGate::LANE_NEW);
    }

    public function testResumeLaneTakesAFreeSlotImmediately(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 1, 'concurrency.per_user' => 0]);

        Cache::put('ai:waiting:' . InferenceGate::LANE_RESUME, 1, 60);

        $lease = $gate->acquire('user-1', InferenceGate::LANE_RESUME);
        $this->assertFalse($lease->passthrough);
        $lease->release();
    }

    public function testReportsQueuePositionWhileWaiting(): void
    {
        $gate = $this->gate(config: [
            'concurrency.slots' => 1,
            'concurrency.per_user' => 0,
            'concurrency.max_wait_seconds' => 2,
        ]);

        $held = $gate->acquire('user-1');
        $frames = [];

        try {
            $gate->acquire('user-2', InferenceGate::LANE_NEW, function (int $position, int $ahead, int $eta) use (&$frames) {
                $frames[] = compact('position', 'ahead', 'eta');
            });
        } catch (AIServiceException $e) {
            // expected once the wait elapses
        } finally {
            $held->release();
        }

        $this->assertNotEmpty($frames, 'The gate should report queue position to a streaming caller.');
        $this->assertSame(1, $frames[0]['position']);
        $this->assertGreaterThan(0, $frames[0]['eta']);
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

    public function testStatsSnapshotReflectsLiveSlotUsage(): void
    {
        $gate = $this->gate(config: ['concurrency.slots' => 2, 'concurrency.per_user' => 0]);

        $lease = $gate->acquire('user-1');
        $stats = $gate->stats();

        $this->assertTrue($stats['applies']);
        $this->assertSame(2, $stats['slots']);
        $this->assertSame(1, $stats['slots_in_use']);
        $this->assertSame(0, $stats['queue_depth']);

        $lease->release();

        $this->assertFalse($this->gate(ProviderConfig::PROVIDER_ANTHROPIC)->stats()['applies']);
    }
}
