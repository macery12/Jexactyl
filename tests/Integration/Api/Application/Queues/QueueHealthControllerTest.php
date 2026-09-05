<?php

namespace Everest\Tests\Integration\Api\Application\Queues;

use Illuminate\Support\Str;
use Everest\Models\AdminRole;
use Everest\Events\ActivityLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Tests\Integration\Api\Application\ApplicationApiIntegrationTestCase;

/**
 * These are the first destructive endpoints on the queue page, and the three
 * queue capabilities are deliberately not interchangeable: reading the failed
 * list, re-running the work, and destroying the only copy of a payload are
 * three different kinds of authority.
 *
 * The resolver test proves every route *declares* a permission. This proves the
 * declaration is the right one, over HTTP, with a key holding exactly one of
 * them -- which is the thing a reader of the route file cannot check.
 *
 * One refused request per test, deliberately. The panel's exception handler
 * calls `rollBack(0)` when it renders, which unwinds the transaction this suite
 * runs inside: after a request that throws, the fixtures are gone -- rows, the
 * access profile and the API key with them -- and everything after it in the
 * same test would be answered 401 for reasons that have nothing to do with what
 * was being tested. Hence the data providers.
 */
class QueueHealthControllerTest extends ApplicationApiIntegrationTestCase
{
    /**
     * Bind the calling key to a profile holding exactly these capabilities.
     * The user behind the key is an owner; an Application key must never
     * inherit that, which is half of what these assertions are checking.
     *
     * @param list<string> $capabilities
     */
    private function keyHolding(array $capabilities): void
    {
        $profile = AdminRole::query()->forceCreate([
            'name' => 'Queue scope ' . bin2hex(random_bytes(6)),
            'description' => 'Queue authorization test profile.',
            'sort_id' => 999,
            'permissions' => $capabilities,
            'color' => null,
            'is_system' => false,
            'is_owner' => false,
            'api_eligible' => true,
        ]);

        $this->createNewDefaultApiKey($this->getApiUser(), ['admin_role_id' => $profile->id]);
    }

    private function recordFailure(string $queue = 'mail'): string
    {
        $uuid = (string) Str::uuid();

        DB::table('failed_jobs')->insert([
            'uuid' => $uuid,
            'connection' => 'database',
            'queue' => $queue,
            'payload' => json_encode(['uuid' => $uuid, 'displayName' => 'Everest\\Jobs\\Email\\SendEmailJob']),
            'failed_at' => now()->toDateTimeString(),
            'exception' => 'RuntimeException: SMTP connection refused',
        ]);

        return $uuid;
    }

    /**
     * Every endpoint that changes something, as [verb, path, body]. `{uuid}` is
     * substituted for a real failure so the refusal is about authority rather
     * than about the row being missing.
     *
     * @return iterable<string, array{0: string, 1: string, 2: array<string, mixed>}>
     */
    public static function actionEndpoints(): iterable
    {
        yield 'retry one' => ['POST', '/api/application/queues/failed/{uuid}/retry', []];
        yield 'retry a selection' => ['POST', '/api/application/queues/failed/retry', ['uuids' => ['{uuid}']]];
        yield 'discard one' => ['DELETE', '/api/application/queues/failed/{uuid}', []];
        yield 'discard a selection' => ['DELETE', '/api/application/queues/failed', ['uuids' => ['{uuid}']]];
        yield 'preview a sweep' => ['POST', '/api/application/queues/failed/sweep-preview', ['olderThanDays' => 1]];
        yield 'sweep' => ['DELETE', '/api/application/queues/failed', ['olderThanDays' => 1]];
    }

    /**
     * Reading the queue must not carry the authority to act on it. This is the
     * capability most likely to be delegated widely, so its blast radius is the
     * one that matters most.
     *
     * @param array<string, mixed> $body
     */
    #[DataProvider('actionEndpoints')]
    public function testReadingTheQueueDoesNotCarryTheAuthorityToActOnIt(string $verb, string $path, array $body): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ]);
        $uuid = $this->recordFailure();

        $this->json($verb, str_replace('{uuid}', $uuid, $path), json_decode(str_replace('{uuid}', $uuid, json_encode($body)), true))
            ->assertStatus(403);
    }

    public function testTheReadCapabilityDoesReachEverythingItIsFor(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ]);
        $uuid = $this->recordFailure();

        $this->getJson('/api/application/queues')->assertStatus(200);
        $this->getJson('/api/application/queues/failed')->assertStatus(200)->assertJsonPath('total', 1);
        $this->getJson('/api/application/queues/failed/' . $uuid)->assertStatus(200);

        $this->assertDatabaseHas('failed_jobs', ['uuid' => $uuid]);
    }

    /**
     * Discarding destroys the payload; retrying re-runs the work -- mail gets
     * sent, nodes get called, cards get charged. Holding one must not confer
     * the other.
     */
    public function testDiscardingRequiresTheDeleteCapabilityAndNotTheRetryOne(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_DELETE]);
        $uuid = $this->recordFailure();

        $this->deleteJson('/api/application/queues/failed/' . $uuid)->assertStatus(204);

        $this->assertDatabaseMissing('failed_jobs', ['uuid' => $uuid]);

        // The row was the only copy of the payload. This entry is now the only
        // record that the failure ever existed.
        $this->assertActivityLogged('admin:queues:delete');
    }

    public function testAKeyThatCanOnlyRetryCannotDiscard(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_RETRY]);

        $this->deleteJson('/api/application/queues/failed/' . $this->recordFailure())->assertStatus(403);
    }

    public function testAKeyThatCanOnlyDiscardCannotRetry(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_DELETE]);

        $this->postJson('/api/application/queues/failed/' . $this->recordFailure() . '/retry')->assertStatus(403);
    }

    public function testAKeyWithNoQueueCapabilityIsRefusedEvenTheRead(): void
    {
        $this->keyHolding([AdminRole::USERS_READ]);

        $this->getJson('/api/application/queues')->assertStatus(403);
    }

    /**
     * `queue:retry` reads a lone id of `all` as "retry every failure in the
     * table". The route constraint means such a path never reaches a controller.
     *
     * @return iterable<string, array{0: string, 1: string}>
     */
    public static function sentinelPaths(): iterable
    {
        yield 'retry' => ['POST', '/api/application/queues/failed/all/retry'];
        yield 'discard' => ['DELETE', '/api/application/queues/failed/all'];
    }

    #[DataProvider('sentinelPaths')]
    public function testAPathSegmentThatIsNotAUuidNeverReachesTheController(string $verb, string $path): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_RETRY, AdminRole::QUEUES_DELETE]);

        $this->json($verb, $path)->assertStatus(404);
    }

    public function testTheRetryAllSentinelIsRejectedInASelectionToo(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_RETRY]);

        $this->postJson('/api/application/queues/failed/retry', ['uuids' => ['all']])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.meta.source_field', 'uuids.0')
            ->assertJsonPath('errors.0.meta.rule', 'uuid');
    }

    /**
     * A request carrying both shapes is ambiguous, and the ambiguity resolves
     * towards deleting far more than was asked for.
     */
    public function testASelectionAndASweepScopeCannotBeSentTogether(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_DELETE]);

        $this->deleteJson('/api/application/queues/failed', [
            'uuids' => [(string) Str::uuid()],
            'olderThanDays' => 1,
        ])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.meta.source_field', 'uuids')
            ->assertJsonPath('errors.0.meta.rule', 'prohibits');
    }

    /**
     * @return iterable<string, array{0: string, 1: string}>
     */
    public static function unscopedSweeps(): iterable
    {
        yield 'preview' => ['POST', '/api/application/queues/failed/sweep-preview'];
        yield 'sweep' => ['DELETE', '/api/application/queues/failed'];
    }

    /**
     * There is deliberately no shape of this request that means "delete
     * everything", and the preview refuses on the same terms rather than
     * quietly reporting the size of the whole table.
     */
    #[DataProvider('unscopedSweeps')]
    public function testAnUnscopedSweepIsRefused(string $verb, string $path): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_DELETE]);

        $this->json($verb, $path, [])->assertStatus(422)->assertJsonPath('errors.0.code', 'UnscopedSweep');

        // A refused request must leave no entry claiming a sweep happened. The
        // sweep logs before it destroys anything, so the refusal has to come
        // first or the log tells a story the request never lived.
        Event::assertNotDispatched(ActivityLogged::class);
    }

    public function testAScopedSweepReportsWhatItTookAndWhatIsLeft(): void
    {
        $this->keyHolding([AdminRole::QUEUES_READ, AdminRole::QUEUES_DELETE]);
        $this->recordFailure('mail');
        $this->recordFailure('dns');

        $this->postJson('/api/application/queues/failed/sweep-preview', ['queue' => 'mail'])
            ->assertStatus(200)
            ->assertJson(['count' => 1]);

        $this->deleteJson('/api/application/queues/failed', ['queue' => 'mail'])
            ->assertStatus(200)
            ->assertJson(['deleted' => 1, 'remaining' => 0]);

        $this->assertSame(1, DB::table('failed_jobs')->count());
    }
}
