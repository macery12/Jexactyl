<?php

namespace Everest\Tests\Unit\Queue;

use Everest\Tests\TestCase;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Queue\FailedJobRepository;

/**
 * A failure count an operator cannot open is a dead end: it says something
 * broke, not what, and leaves recovery on the command line. These cover the
 * list behind the count and the retry that acts on it.
 */
class FailedJobRepositoryTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        config(['queue.failed.driver' => 'database-uuids', 'queue.failed.database' => null, 'queue.failed.table' => 'failed_jobs']);

        Schema::dropIfExists('failed_jobs');
        Schema::create('failed_jobs', function (Blueprint $table) {
            $table->increments('id');
            $table->string('uuid')->nullable()->unique();
            $table->text('connection');
            $table->text('queue');
            $table->longText('payload');
            $table->timestamp('failed_at');
            $table->text('exception');
        });

        Schema::dropIfExists('jobs');
        Schema::create('jobs', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('queue')->index();
            $table->longText('payload');
            $table->unsignedTinyInteger('attempts');
            $table->unsignedInteger('reserved_at')->nullable();
            $table->unsignedInteger('available_at');
            $table->unsignedInteger('created_at');
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('failed_jobs');
        Schema::dropIfExists('jobs');

        parent::tearDown();
    }

    private function repository(): FailedJobRepository
    {
        return $this->app->make(FailedJobRepository::class);
    }

    private function recordFailure(
        string $job = 'Everest\\Jobs\\Email\\SendEmailJob',
        string $queue = 'mail',
        string $exception = "RuntimeException: SMTP connection refused\n#0 /var/www/app.php(1)",
        ?string $failedAt = null,
    ): string {
        $uuid = (string) Str::uuid();

        DB::table('failed_jobs')->insert([
            'uuid' => $uuid,
            'connection' => 'database',
            'queue' => $queue,
            'payload' => json_encode(['uuid' => $uuid, 'displayName' => $job, 'job' => 'Illuminate\\Queue\\CallQueuedHandler@call', 'attempts' => 3, 'data' => ['commandName' => $job]]),
            'failed_at' => $failedAt ?? now()->toDateTimeString(),
            'exception' => $exception,
        ]);

        return $uuid;
    }

    public function testAFailureIsListedWithTheJobAndTheErrorItReported(): void
    {
        $this->recordFailure();

        $page = $this->repository()->paginate();

        $this->assertCount(1, $page['items']);
        $this->assertSame('Everest\\Jobs\\Email\\SendEmailJob', $page['items'][0]['job']);
        $this->assertSame('mail', $page['items'][0]['queue']);
        $this->assertSame(3, $page['items'][0]['attempts']);
    }

    /**
     * The first line of a trace is `Class: message`, which is the whole story in
     * most cases. Splitting it lets the table show the class without the
     * message being swallowed by truncation.
     */
    public function testTheExceptionClassIsSplitFromItsMessage(): void
    {
        $this->recordFailure();

        $item = $this->repository()->paginate()['items'][0];

        $this->assertSame('RuntimeException', $item['exceptionClass']);
        $this->assertSame('SMTP connection refused', $item['exceptionMessage']);
    }

    public function testATraceWithoutALeadingClassStillYieldsAMessage(): void
    {
        $this->recordFailure(exception: 'the worker was killed before it could report');

        $item = $this->repository()->paginate()['items'][0];

        $this->assertNull($item['exceptionClass']);
        $this->assertSame('the worker was killed before it could report', $item['exceptionMessage']);
    }

    /**
     * A page of stack traces has no business riding along with a list that the
     * admin page polls -- the trace is fetched only when a row is opened.
     */
    public function testTheStackTraceIsWithheldFromTheListAndPresentOnTheDetail(): void
    {
        $uuid = $this->recordFailure();

        $this->assertArrayNotHasKey('exception', $this->repository()->paginate()['items'][0]);
        $this->assertStringContainsString('#0 /var/www/app.php', $this->repository()->find($uuid)['exception']);
    }

    public function testTheQueueNameIsResolvedBackToItsLane(): void
    {
        config(['queue.lanes.mail' => 'mail']);
        $this->recordFailure(queue: 'mail');

        $this->assertSame('mail', $this->repository()->paginate()['items'][0]['lane']);
    }

    /**
     * A queue the panel no longer routes to still has to list, or a failure on a
     * renamed lane becomes invisible.
     */
    public function testAFailureOnAnUnknownQueueStillLists(): void
    {
        $this->recordFailure(queue: 'retired-lane');

        $item = $this->repository()->paginate()['items'][0];

        $this->assertNull($item['lane']);
        $this->assertSame('retired-lane', $item['queue']);
    }

    public function testTheNewestFailureComesFirst(): void
    {
        $this->recordFailure(job: 'OldJob', failedAt: now()->subDay()->toDateTimeString());
        $this->recordFailure(job: 'NewJob');

        $this->assertSame('NewJob', $this->repository()->paginate()['items'][0]['job']);
    }

    public function testFailuresCanBeNarrowedToOneQueue(): void
    {
        $this->recordFailure(queue: 'mail');
        $this->recordFailure(queue: 'dns');

        $page = $this->repository()->paginate(queue: 'dns');

        $this->assertSame(1, $page['total']);
        $this->assertSame('dns', $page['items'][0]['queue']);
        $this->assertSame(['dns', 'mail'], $page['queues'], 'The filter must offer the queues that actually have failures.');
    }

    public function testRetryingPushesTheJobBackAndClearsTheFailure(): void
    {
        $uuid = $this->recordFailure();

        $this->assertTrue($this->repository()->retry($uuid));

        $this->assertNull($this->repository()->find($uuid), 'A retried job must not remain retryable from the same record.');
        $this->assertSame(1, DB::table('jobs')->where('queue', 'mail')->count(), 'The job should be back on its original queue.');
    }

    public function testRetryingSomethingThatIsNotThereIsRefusedRatherThanGuessed(): void
    {
        $this->assertFalse($this->repository()->retry((string) Str::uuid()));
    }

    /**
     * Not every install stores failures in the database. That is a legitimate
     * setup, not an error -- it just means there is nothing to show.
     */
    public function testANonDatabaseFailedStoreListsNothingInsteadOfThrowing(): void
    {
        config(['queue.failed.driver' => 'null']);

        $this->assertFalse($this->repository()->available());
        $this->assertSame([], $this->repository()->paginate()['items']);
        $this->assertNull($this->repository()->find((string) Str::uuid()));
    }

    /**
     * The list endpoint is gated on `queues.read`, the lowest of the three
     * queue capabilities -- and Laravel puts a query's bindings into the
     * exception message it throws. Masking the payload and not this would have
     * left the leak in the half nobody thinks to look at.
     */
    public function testAnExceptionMessageIsMaskedBeforeItReachesTheList(): void
    {
        config(['modules.ai.privacy.enabled' => false]);

        $this->recordFailure(exception: 'QueryException: SQLSTATE[23000] (SQL: insert into users (password) '
            . 'values ($2y$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234))');

        $item = $this->repository()->paginate()['items'][0];

        $this->assertStringNotContainsString('$2y$10$abcdefghij', $item['exceptionMessage']);
        $this->assertStringContainsString('[redacted]', $item['exceptionMessage']);
        $this->assertSame('QueryException', $item['exceptionClass'], 'Masking must not cost the class name.');
    }

    public function testTheTraceIsMaskedToo(): void
    {
        config(['modules.ai.privacy.enabled' => false]);

        $uuid = $this->recordFailure(exception: "RuntimeException: refused\n#0 connect(mysql://panel:sup3rSecret@db/panel)");

        $this->assertStringNotContainsString('sup3rSecret', $this->repository()->find($uuid)['exception']);
    }

    /**
     * The audit log needs the job and the queue, not a rebuilt payload. Keeping
     * the two apart is what stops a bulk discard paying for a redaction pass
     * per row that nothing ever reads.
     */
    public function testTheSummaryCarriesIdentityWithoutTheTraceOrPayload(): void
    {
        $uuid = $this->recordFailure();

        $summary = $this->repository()->summary($uuid);

        $this->assertSame('Everest\\Jobs\\Email\\SendEmailJob', $summary['job']);
        $this->assertSame('mail', $summary['queue']);
        $this->assertArrayNotHasKey('payload', $summary);
        $this->assertArrayNotHasKey('exception', $summary);
        $this->assertNull($this->repository()->summary((string) Str::uuid()));
    }

    public function testDiscardingRemovesTheRowAndReportsWhetherItWentAway(): void
    {
        $uuid = $this->recordFailure();

        $this->assertTrue($this->repository()->delete($uuid));
        $this->assertSame(0, DB::table('failed_jobs')->count());
        $this->assertFalse($this->repository()->delete($uuid), 'A second discard has nothing to discard.');
    }

    public function testDiscardingASelectionReportsWhatActuallyWent(): void
    {
        $first = $this->recordFailure();
        $second = $this->recordFailure(queue: 'dns');
        $this->recordFailure(queue: 'mods');

        $this->assertSame(2, $this->repository()->deleteMany([$first, $second, (string) Str::uuid()]));
        $this->assertSame(1, DB::table('failed_jobs')->count());
    }

    /**
     * There is deliberately no shape of this call that means "delete
     * everything": an unscoped flush is one mis-click away from destroying
     * every payload in the retention window.
     */
    public function testAnUnscopedSweepIsRefusedRatherThanTreatedAsAll(): void
    {
        $this->recordFailure();

        $this->assertNull($this->repository()->purge(null, null));
        $this->assertNull($this->repository()->purge('', null));
        $this->assertSame(1, DB::table('failed_jobs')->count());
    }

    public function testASweepTakesOnlyWhatItsScopeNames(): void
    {
        $this->recordFailure(queue: 'mail', failedAt: now()->subDays(30)->toDateTimeString());
        $this->recordFailure(queue: 'dns', failedAt: now()->subDays(30)->toDateTimeString());
        $this->recordFailure(queue: 'mail');

        $this->assertSame(1, $this->repository()->countMatching('mail', 7));
        $this->assertSame(1, $this->repository()->purge('mail', 7));
        $this->assertSame(2, DB::table('failed_jobs')->count());
    }

    /**
     * A sweep that walks an unbounded table is a request that does not finish:
     * it dies on the time limit part-way through, having destroyed rows nobody
     * can afterwards enumerate. It takes a page and reports the remainder.
     */
    public function testASweepIsCappedSoOneRequestCannotWalkTheWholeTable(): void
    {
        $rows = [];
        for ($i = 0; $i < FailedJobRepository::MAX_SWEEP_ROWS + 3; ++$i) {
            $uuid = (string) Str::uuid();
            $rows[] = [
                'uuid' => $uuid,
                'connection' => 'database',
                'queue' => 'mail',
                'payload' => json_encode(['uuid' => $uuid, 'displayName' => 'SomeJob']),
                'failed_at' => now()->subDays(30)->toDateTimeString(),
                'exception' => 'RuntimeException: nope',
            ];
        }
        DB::table('failed_jobs')->insert($rows);

        $this->assertSame(FailedJobRepository::MAX_SWEEP_ROWS, $this->repository()->purge('mail', 7));
        $this->assertSame(3, $this->repository()->countMatching('mail', 7), 'The remainder has to be reportable.');
    }

    /**
     * `queue:retry` reads a lone id of `all` as "retry every failure in the
     * table". Nothing shaped like a uuid can reach that sentinel, but an
     * endpoint that turns one request into an unbounded one is not something to
     * leave standing on the strength of a validation rule alone.
     */
    public function testTheRetryAllSentinelIsNotReachableThroughASelection(): void
    {
        $this->recordFailure();
        $this->recordFailure(queue: 'dns');

        $this->assertSame(0, $this->repository()->retryMany(['all']));
        $this->assertSame(2, DB::table('failed_jobs')->count(), 'Nothing may be retried by naming the sentinel.');
        $this->assertSame(0, DB::table('jobs')->count());
    }

    public function testRetryingASelectionReportsWhatActuallyWent(): void
    {
        $first = $this->recordFailure();
        $second = $this->recordFailure(queue: 'dns');

        $this->assertSame(2, $this->repository()->retryMany([$first, $second, (string) Str::uuid()]));
        $this->assertSame(0, DB::table('failed_jobs')->count());
    }
}
