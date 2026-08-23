<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolCatalogue;
use Everest\Services\AI\Agent\WorkingSetPlanner;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\PrerequisiteResolver;
use Everest\Services\AI\Agent\ToolDiscoveryService;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * `search_tools` and `load_tools` as the model experiences them.
 *
 * The design decision under test is that a search *loads* what it finds. A
 * strict search-then-load split costs an extra inference step on every task, out
 * of a budget of twelve, on exactly the small models this whole mechanism exists
 * to serve — so a search commits its top match, and the boundary that makes that
 * safe is that loading is not executing.
 */
class ToolDiscoveryServiceTest extends TestCase
{
    private function registry(): ToolRegistry
    {
        $authorizer = \Mockery::mock(AdminAuthorizer::class);
        $authorizer->shouldReceive('hasCapability')->andReturn(true);
        $authorizer->shouldReceive('isOwner')->andReturn(true);

        return new ToolRegistry(new RiskGate(new ConsoleCommandGate()), new SchemaValidator(), $authorizer);
    }

    private function service(?ToolRegistry $registry = null): ToolDiscoveryService
    {
        $registry ??= $this->registry();
        $prerequisites = new PrerequisiteResolver();

        return new ToolDiscoveryService(
            new ToolCatalogue($registry),
            new WorkingSetPlanner($registry, $prerequisites),
            $prerequisites,
        );
    }

    private function user(): User
    {
        $user = \Mockery::mock(User::class)->makePartial();
        $user->shouldReceive('can')->andReturn(true);
        $user->id = 5;

        return $user;
    }

    private function server(): Server
    {
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Survival SMP';

        return $server;
    }

    private function context(bool $admin = false): AgentContext
    {
        return new AgentContext($this->user(), $admin ? null : $this->server(), 'turn-discovery');
    }

    /*
    |--------------------------------------------------------------------------
    | Search
    |--------------------------------------------------------------------------
    */

    public function testASearchLoadsWhatItFinds(): void
    {
        $context = $this->context();

        $result = $this->service()->search($context, ['query' => 'do i have any backups'], 12, 3);

        $this->assertTrue($result->ok);
        $this->assertSame(['backups_list'], $result->data['loaded']);
        $this->assertContains('backups_list', $context->pinned);
    }

    /**
     * Only the top match is *held*. The rest are suggestions, and a working set
     * that turned over completely on one broad query would not be a working set.
     */
    public function testSecondaryMatchesAreSuggestionsRatherThanPins(): void
    {
        $context = $this->context();

        $this->service()->search($context, ['query' => 'files', 'limit' => 4], 12, 3);

        $this->assertCount(1, $context->pinned);
        $this->assertNotEmpty($context->retrieved);
        $this->assertSame([], array_intersect($context->pinned, $context->retrieved));
    }

    /**
     * A search that finds nothing is an error the model must act on.
     *
     * An empty success reads as an invitation to rephrase, which is how a
     * no-progress loop starts. Saying "this does not exist" is what lets it
     * answer honestly instead.
     */
    public function testAnUnmatchedSearchIsAnErrorAndChangesNothing(): void
    {
        $context = $this->context();

        $result = $this->service()->search($context, ['query' => 'reticulate the splines'], 12, 3);

        $this->assertFalse($result->ok);
        $this->assertSame('tool_not_found', $result->code);
        $this->assertSame([], $context->pinned);
    }

    public function testASearchWithNoQueryAtAllIsRetryable(): void
    {
        $result = $this->service()->search($this->context(), [], 12, 3);

        $this->assertFalse($result->ok);
        $this->assertTrue($result->retryable);
    }

    /**
     * The limit is clamped to what the schema promises, whatever arrives.
     */
    public function testTheResultLimitIsClamped(): void
    {
        $result = $this->service()->search($this->context(), ['query' => 'files', 'limit' => 99], 12, 3);

        $this->assertLessThanOrEqual(SharedTools::MAX_SEARCH_RESULTS, count($result->data['matches']));
    }

    /*
    |--------------------------------------------------------------------------
    | Search across the assist boundary
    |--------------------------------------------------------------------------
    */

    /**
     * The scenario from the design document, in one call.
     *
     * An admin searching for a startup command finds `startup_list`, is told it
     * is not usable yet, and is told which tool opens the way — which is the
     * difference between a dead end and a plan.
     */
    public function testAnAdminSearchReportsThePrerequisiteRatherThanFailing(): void
    {
        $context = $this->context(admin: true);

        $result = $this->service()->search($context, ['query' => 'startup command'], 12, 3);

        $this->assertTrue($result->ok);

        $match = $result->data['matches'][0];
        $this->assertSame('startup_list', $match['name']);
        $this->assertFalse($match['available_now']);
        $this->assertSame('admin_servers_list', $match['requires'][0]['tool']);
        $this->assertNotEmpty($result->data['next']);
    }

    /**
     * Finding it pins it, and pins the way to reach it.
     */
    public function testAnAdminSearchPinsTheTargetAndItsGateway(): void
    {
        $context = $this->context(admin: true);

        $this->service()->search($context, ['query' => 'startup command'], 12, 3);

        $this->assertContains('startup_list', $context->pinned);
        $this->assertContains('admin_servers_list', $context->pinned);
        $this->assertContains('admin_assist_server', $context->pinned);
    }

    /*
    |--------------------------------------------------------------------------
    | Load
    |--------------------------------------------------------------------------
    */

    public function testLoadingByExactNamePinsIt(): void
    {
        $context = $this->context();

        $result = $this->service()->load($context, ['tools' => ['backup_create'], 'reason' => 'asked'], 12);

        $this->assertTrue($result->ok);
        $this->assertContains('backup_create', $result->data['loaded']);
        $this->assertContains('backup_create', $context->pinned);
    }

    /**
     * A load naming one bad tool loads none of them.
     *
     * A partial load leaves the model believing it holds something it does not,
     * and the next call fails somewhere less legible than here.
     */
    public function testAPartlyUnknownLoadIsRefusedWhole(): void
    {
        $context = $this->context();

        $result = $this->service()->load(
            $context,
            ['tools' => ['backup_create', 'summon_a_dragon'], 'reason' => 'asked'],
            12,
        );

        $this->assertFalse($result->ok);
        $this->assertSame('tool_not_found', $result->code);
        $this->assertSame([], $context->pinned);
    }

    /**
     * An oversized load names what would not fit and changes nothing.
     */
    public function testAnOversizedLoadIsRefusedAndReported(): void
    {
        $context = $this->context();
        $context->pin('backups_list', 'earlier');

        $result = $this->service()->load(
            $context,
            [
                'tools' => ['files_compress', 'files_rename', 'files_copy', 'files_delete'],
                'reason' => 'tidy up',
            ],
            2,
        );

        $this->assertFalse($result->ok);
        $this->assertSame('tool_set_too_large', $result->code);
        $this->assertNotEmpty($result->fields['conflicting']);
        $this->assertSame(['backups_list'], $context->pinned, 'A refused load must change nothing.');
    }

    public function testDroppingReleasesAPin(): void
    {
        $context = $this->context();
        $context->pin('backups_list', 'earlier');

        $result = $this->service()->load(
            $context,
            ['tools' => ['databases_list'], 'drop' => ['backups_list'], 'reason' => 'moved on'],
            12,
        );

        $this->assertTrue($result->ok);
        $this->assertNotContains('backups_list', $context->pinned);
        $this->assertContains('databases_list', $context->pinned);
    }

    /*
    |--------------------------------------------------------------------------
    | Exact names the user typed
    |--------------------------------------------------------------------------
    */

    public function testAToolNamedByTheUserIsPinnedBeforeAnyInference(): void
    {
        $context = $this->context();

        $this->service()->pinNamedTools($context, 'can you run startup_list for me');

        $this->assertContains('startup_list', $context->pinned);
        $this->assertSame('named by the user', $context->pinReasons['startup_list']);
    }

    /**
     * Word boundaries only. Prose that happens to contain part of a tool name is
     * not a request for that tool.
     */
    public function testPartialWordsDoNotPinATool(): void
    {
        $context = $this->context();

        $this->service()->pinNamedTools($context, 'the startup_listing service is down');

        $this->assertSame([], $context->pinned);
    }

    /**
     * Naming a tool the surface cannot reach at all pins nothing.
     */
    public function testAToolOutsideTheCatalogueIsNotPinnedByName(): void
    {
        $context = $this->context();

        $this->service()->pinNamedTools($context, 'please call admin_overview');

        $this->assertSame([], $context->pinned);
    }

    /*
    |--------------------------------------------------------------------------
    | Budget
    |--------------------------------------------------------------------------
    */

    /**
     * An explicit setting always wins over detection.
     */
    public function testAnExplicitToolLimitOverridesTheProfile(): void
    {
        config()->set('modules.ai.agent.max_tools', 9);

        $budget = app(ToolBudget::class);

        $this->assertSame(ToolBudget::PROFILE_MANUAL, $budget->profile());
        $this->assertSame(9, $budget->schemas());
    }

    /**
     * And it cannot be set below the tools that are always offered.
     */
    public function testTheBudgetNeverFallsBelowTheAlwaysOfferedTools(): void
    {
        config()->set('modules.ai.agent.max_tools', 1);

        $this->assertGreaterThanOrEqual(count(SharedTools::ALWAYS_OFFERED), app(ToolBudget::class)->schemas());
    }
}
