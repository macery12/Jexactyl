<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Everest\Jobs\AI\RunAgentTurnJob;
use Everest\Jobs\Schedule\RunTaskJob;
use Everest\Services\Queue\JobCatalogue;

/**
 * The catalogue is what stops every queue surface from showing a raw FQCN.
 *
 * Its fallback matters more than its map: extensions dispatch jobs the panel
 * has never heard of, and the page has to stay readable for them. The naming
 * rules below have each already produced a wrong answer once -- a `Jobs`
 * namespace losing its "s", an acronym coming back as `a_i` -- and neither is
 * the sort of thing anyone notices in review.
 */
class JobCatalogueTest extends TestCase
{
    private function catalogue(): JobCatalogue
    {
        return $this->app->make(JobCatalogue::class);
    }

    public function testCataloguedJobCarriesItsTitleSummaryAndLane(): void
    {
        $described = $this->catalogue()->describe(RunTaskJob::class);

        $this->assertTrue($described['known']);
        $this->assertSame('Run scheduled task', $described['title']);
        $this->assertSame('schedules', $described['lane']);
        $this->assertNotNull($described['summary']);
    }

    public function testUnknownJobFallsBackToAReadableName(): void
    {
        $described = $this->catalogue()->describe('Acme\\Jobs\\SyncBillingJob');

        $this->assertFalse($described['known']);
        $this->assertSame('Sync billing', $described['title']);
        $this->assertNull($described['summary']);
    }

    /**
     * `Str::replaceLast('Job', '')` applied to every segment turns the `Jobs`
     * namespace into `s`, which produced keys like `acme.s.sync_billing`.
     */
    public function testOnlyTheClassSegmentLosesItsJobSuffix(): void
    {
        $this->assertSame('acme.jobs.sync_billing', $this->catalogue()->describe('Acme\\Jobs\\SyncBillingJob')['key']);
    }

    /** Str::snake('AI') is 'a_i', which is not a name anyone would recognise. */
    public function testAcronymSegmentsStayIntactInTheKey(): void
    {
        $this->assertSame('ai.run_agent_turn', $this->catalogue()->describe(RunAgentTurnJob::class)['key']);
    }

    public function testEveryRoutedJobIsCatalogued(): void
    {
        $routed = array_keys(config('queue.routing'));
        $catalogued = array_keys(config('queue.catalogue'));

        // A job worth giving its own lane is a job worth naming: an uncatalogued
        // one shows up on the admin page as a prettified class instead of as
        // the sentence an admin reads before pressing Retry.
        $this->assertSame([], array_diff($routed, $catalogued));
    }

    public function testEveryLaneHasADescription(): void
    {
        foreach (array_keys(config('queue.lanes')) as $lane) {
            $described = $this->catalogue()->describeLane($lane);

            $this->assertNotSame('', $described['title'], "Lane [{$lane}] has no title.");
            $this->assertNotNull($described['summary'], "Lane [{$lane}] has no summary.");
        }
    }

    public function testEverySupervisorHasADescription(): void
    {
        $meta = config('queue.supervisor_meta');

        foreach (array_keys($this->app->make(\Everest\Services\Queue\QueueTopology::class)->horizonSupervisors()) as $name) {
            $this->assertArrayHasKey($name, $meta, "Supervisor [{$name}] has no description; the workers tab would show its config key.");
        }
    }
}
