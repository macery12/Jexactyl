<?php

namespace Everest\Tests\Integration\Jobs\Mods;

use Everest\Models\Server;
use Everest\Models\DownloadQueue;
use Everest\Jobs\InstallModpackJob;
use Everest\Services\Mods\CurseForgeService;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Repositories\Wings\DaemonScriptRepository;
use Everest\Repositories\Wings\DaemonServerRepository;
use Everest\Exceptions\Service\Mods\ModpackInstallException;

/**
 * A modpack install can run for an hour, so it cannot be made restart-proof by
 * making restarts wait -- it has to survive being interrupted. The job records
 * its phase and batch offset on the `download_queue` row for exactly that, and
 * the guarantee is worth nothing unless a resumed attempt genuinely skips what
 * it already did: re-wiping a server that is half-installed destroys work, and
 * re-downloading 250 mods turns a blip into another hour.
 *
 * This is the behaviour that lets `TimeoutStopSec` stay short enough to deploy.
 */
class InstallModpackJobResumeTest extends IntegrationTestCase
{
    private FakeScriptRepository $scripts;

    public function setUp(): void
    {
        parent::setUp();

        $this->scripts = new FakeScriptRepository();
    }

    /**
     * The whole point of the persisted phase. A retry that re-ran the wipe would
     * delete everything the previous attempt installed, and one that re-ran the
     * loader would rewrite the server's startup and image underneath it.
     */
    public function testAResumedInstallSkipsTheWipeLoaderAndOverrides(): void
    {
        $parent = $this->parentQueue(['phase' => 'mods:2/3', 'completed_children' => 100]);
        $startup = $parent->server->startup;

        $this->job($parent, wipe: true, loader: true)->handle($this->curseForge(250), $this->scripts, $this->serverRepo());

        $this->assertFalse($this->scripts->ran('M12_WIPE_DONE'), 'A resumed install must not re-wipe a half-installed server.');
        $this->assertFalse($this->scripts->ran('M12_LOADER_DONE'), 'A resumed install must not reinstall the loader.');
        $this->assertFalse($this->scripts->ran('OVERRIDES_DONE'), 'A resumed install must not re-extract overrides over existing config.');

        $this->assertSame($startup, $parent->server->fresh()->startup, 'The startup command belongs to the loader step, which did not run.');
    }

    /**
     * The control for the test above: without it, a resume test passes just as
     * well against a job that never runs those phases at all.
     */
    public function testAFreshInstallRunsThePreModsPhases(): void
    {
        $parent = $this->parentQueue();

        $this->job($parent, wipe: true, loader: true)->handle($this->curseForge(3), $this->scripts, $this->serverRepo());

        $this->assertTrue($this->scripts->ran('M12_WIPE_DONE'));
        $this->assertTrue($this->scripts->ran('M12_LOADER_DONE'));
        $this->assertTrue($this->scripts->ran('OVERRIDES_DONE'));
    }

    /**
     * Skipping the pre-mods phases is only half of resuming. Restarting the mod
     * downloads from zero would still cost the full hour, even though the node
     * script skips files already present.
     */
    public function testModBatchesResumeFromTheRecordedOffset(): void
    {
        $parent = $this->parentQueue(['phase' => 'mods:2/3', 'completed_children' => 100]);

        $this->job($parent)->handle($this->curseForge(250), $this->scripts, $this->serverRepo());

        $first = $this->scripts->batches()[0] ?? '';

        $this->assertStringContainsString('mod-101.jar', $first, 'The first batch after a resume should start at the recorded offset.');
        $this->assertStringNotContainsString('mod-001.jar', $first, 'Mods already downloaded must not be queued again.');
    }

    public function testACompletedInstallReportsEveryModAndClearsThePhase(): void
    {
        $parent = $this->parentQueue();

        $this->job($parent)->handle($this->curseForge(250), $this->scripts, $this->serverRepo());
        $parent->refresh();

        $this->assertSame(DownloadQueue::STATUS_COMPLETED, $parent->status);
        $this->assertNull($parent->phase);
        $this->assertSame(250, $parent->completed_children);
    }

    /**
     * The offsets are what a retry resumes from, so a failure that cleared them
     * would silently convert every infrastructure blip into a full reinstall.
     */
    public function testARetryableFailureLeavesThePhaseAndOffsetIntact(): void
    {
        $parent = $this->parentQueue(['phase' => 'mods:2/3', 'completed_children' => 100]);
        $this->scripts->failBatch(2);

        try {
            $this->job($parent)->handle($this->curseForge(250), $this->scripts, $this->serverRepo());
            $this->fail('A retryable failure must be rethrown so the queue hands the job back.');
        } catch (ModpackInstallException $e) {
            $this->assertTrue($e->isRetryable());
        }

        $parent->refresh();

        $this->assertSame(200, $parent->completed_children, 'The batch that did succeed must still count.');
        $this->assertStringStartsWith('mods:', (string) $parent->phase, 'The phase must survive so the next attempt skips the pre-mods steps.');
        $this->assertNotSame(DownloadQueue::STATUS_COMPLETED, $parent->status);
    }

    /**
     * A malformed pack is not going to become well-formed on the third attempt.
     * Rethrowing it would burn every retry and delay the failure the operator
     * needs to see.
     */
    public function testATerminalFailureIsNotHandedBackToTheQueue(): void
    {
        $parent = $this->parentQueue();

        // No resolvable download URL for the pack itself: the author disabled
        // third-party distribution, which no retry can change.
        $this->job($parent)->handle($this->curseForge(3, resolvePack: false), $this->scripts, $this->serverRepo());

        $parent->refresh();

        $this->assertSame(DownloadQueue::STATUS_FAILED, $parent->status);
        $this->assertSame([], $this->scripts->batches(), 'Nothing should have been asked of the node.');
    }

    // ---------------------------------------------------------------- helpers

    private function job(DownloadQueue $parent, bool $wipe = false, bool $loader = false): InstallModpackJob
    {
        return new class ($parent, $wipe, $loader) extends InstallModpackJob {
            protected function downloadFile(string $url, string $destPath): void
            {
                // Http::fake() ignores sink(), so the real download would write
                // an empty file and the manifest read would fail before any
                // resume logic ran. Hand over a real zip instead.
                copy(InstallModpackJobResumeTest::fixtureZip(), $destPath);
            }
        };
    }

    private function parentQueue(array $attributes = []): DownloadQueue
    {
        $server = $this->createServerModel();

        return DownloadQueue::create(array_merge([
            'uuid' => \Illuminate\Support\Str::uuid()->toString(),
            'server_id' => $server->id,
            'provider' => 'curseforge',
            'source' => 'modpack',
            'project_id' => '900',
            'file_id' => '901',
            'status' => DownloadQueue::STATUS_PENDING,
            'completed_children' => 0,
            'failed_children' => 0,
        ], $attributes));
    }

    private function curseForge(int $mods, bool $resolvePack = true): CurseForgeService
    {
        return new FakeCurseForgeService($mods, $resolvePack);
    }

    private function serverRepo(): DaemonServerRepository
    {
        return new class () extends DaemonServerRepository {
            // The real constructor wants a connection factory this fake never uses.
            public function __construct()
            {
            }

            public function setServer(Server $server): self
            {
                return $this;
            }

            public function sync(): void
            {
            }
        };
    }

    /**
     * A real zip, because the job opens it with ZipArchive. Built once and
     * reused; the manifest names the same file ids the fake resolver answers to.
     */
    public static function fixtureZip(): string
    {
        // Not storage/: a test run as root would leave a root-owned file there
        // that www-data then cannot replace, which is the exact failure mode the
        // scheduler's cron ownership caused.
        $path = sys_get_temp_dir() . '/m12labs_test_modpack_fixture.zip';

        if (!file_exists($path)) {
            $files = [];
            for ($i = 1; $i <= 250; ++$i) {
                $files[] = ['projectID' => 1000 + $i, 'fileID' => 2000 + $i];
            }

            $zip = new \ZipArchive();
            $zip->open($path, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
            $zip->addFromString('manifest.json', (string) json_encode([
                'overrides' => 'overrides',
                'files' => $files,
                'minecraft' => [
                    'version' => '1.20.1',
                    'modLoaders' => [['id' => 'forge-47.2.0', 'primary' => true]],
                ],
            ]));
            $zip->close();
        }

        return $path;
    }
}

/**
 * Answers for as many mods as the test asks for, named so a batch's contents can
 * be asserted by position.
 */
class FakeCurseForgeService extends CurseForgeService
{
    public function __construct(private int $mods, private bool $resolvePack = true)
    {
    }

    public function resolveFiles(array $fileIds): array
    {
        $resolved = [];

        foreach ($fileIds as $fileId) {
            $fileId = (int) $fileId;

            // 901 is the pack archive itself rather than one of its mods.
            if ($fileId === 901) {
                if ($this->resolvePack) {
                    $resolved[901] = ['download_url' => 'https://example.test/pack.zip', 'file_name' => 'pack.zip'];
                }

                continue;
            }

            $index = $fileId - 2000;

            if ($index >= 1 && $index <= $this->mods) {
                $resolved[$fileId] = [
                    'download_url' => "https://example.test/mod-{$index}.jar",
                    'file_name' => sprintf('mod-%03d.jar', $index),
                    'sha1' => '',
                ];
            }
        }

        return $resolved;
    }

    public function getModsServerSide(array $projectIds): array
    {
        // 1 is "server-side supported"; 3 would mark a mod client-only.
        return array_fill_keys(array_map('intval', $projectIds), 1);
    }
}

/**
 * Records every script the job asks the node to run, and answers each with the
 * sentinel that step expects -- which is also how the test tells the steps apart.
 */
class FakeScriptRepository extends DaemonScriptRepository
{
    /** @var list<string> */
    private array $scripts = [];

    private ?int $failBatchNumber = null;

    private int $batchCount = 0;

    public function __construct()
    {
    }

    public function setServer(Server $server): self
    {
        return $this;
    }

    public function failBatch(int $number): void
    {
        $this->failBatchNumber = $number;
    }

    public function run(string $script, array $environment = [], ?int $timeout = null, ?string $containerImage = null): array
    {
        $this->scripts[] = $script;

        foreach (['M12_WIPE_DONE', 'M12_LOADER_DONE', 'OVERRIDES_DONE'] as $sentinel) {
            if (str_contains($script, $sentinel)) {
                return ['stdout' => $sentinel, 'stderr' => ''];
            }
        }

        ++$this->batchCount;

        if ($this->batchCount === $this->failBatchNumber) {
            // No sentinel: how a batch that died part-way actually looks.
            return ['stdout' => '', 'stderr' => 'curl: (7) Failed to connect'];
        }

        $processed = substr_count($script, 'https://example.test/mod-');

        return ['stdout' => "M12_BATCH_DONE processed={$processed} installed={$processed} failed=0", 'stderr' => ''];
    }

    public function ran(string $sentinel): bool
    {
        foreach ($this->scripts as $script) {
            if (str_contains($script, $sentinel)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    public function batches(): array
    {
        return array_values(array_filter($this->scripts, fn (string $s) => str_contains($s, 'M12_BATCH_DONE')));
    }
}
