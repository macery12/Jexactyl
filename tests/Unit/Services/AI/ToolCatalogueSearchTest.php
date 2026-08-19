<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolCatalogue;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * Whether the model can find the tool it needs.
 *
 * The whole design rests on this working without embeddings. If "startup
 * command" does not reach `startup_list`, retrieval has not made the catalogue
 * smaller — it has made most of it unreachable, which is strictly worse than
 * sending every schema every step.
 *
 * These are behaviour tests, not scoring tests. Nothing here asserts a number:
 * the weights are tuning and will move, while "an exact name wins" and "a plain
 * description finds the right tool" are the contract.
 */
class ToolCatalogueSearchTest extends TestCase
{
    /**
     * @param string[] $disabled tools the operator has turned off
     */
    private function registry(array $disabled = []): ToolRegistry
    {
        $authorizer = \Mockery::mock(AdminAuthorizer::class);
        $authorizer->shouldReceive('hasCapability')->andReturn(true);
        $authorizer->shouldReceive('isOwner')->andReturn(true);

        // The disable list is stubbed on the gate rather than written through
        // `Setting::set`: settings need a database, unit tests do not have one,
        // and a setting written in one test outlives it and quietly removes the
        // tool from every test that follows.
        $riskGate = \Mockery::mock(RiskGate::class, [new ConsoleCommandGate()])->makePartial();
        $riskGate->shouldReceive('disabledTools')->andReturn($disabled);

        return new ToolRegistry($riskGate, new SchemaValidator(), $authorizer);
    }

    private function catalogue(?ToolRegistry $registry = null): ToolCatalogue
    {
        return new ToolCatalogue($registry ?? $this->registry());
    }

    /**
     * @return ToolDefinition[]
     */
    private function candidates(string $scope = ToolDefinition::SCOPE_SERVER, ?ToolRegistry $registry = null): array
    {
        return array_values(array_filter(
            ($registry ?? $this->registry())->all(),
            fn (ToolDefinition $d) => $d->inScope($scope),
        ));
    }

    /**
     * @return string[]
     */
    private function search(string $query, ?string $exact = null, string $scope = ToolDefinition::SCOPE_SERVER): array
    {
        return array_map(
            fn ($match) => $match->name(),
            $this->catalogue()->search($this->candidates($scope), $query, $exact, 5),
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Exact names
    |--------------------------------------------------------------------------
    */

    public function testAnExactNameIsTheFirstResult(): void
    {
        $this->assertSame('startup_list', $this->search('', 'startup_list')[0]);
    }

    /**
     * Case and hyphens are the two things models actually get wrong, and both
     * cost nothing to forgive.
     */
    public function testAnExactNameToleratesCaseAndHyphens(): void
    {
        $this->assertSame('startup_list', $this->search('', 'STARTUP_LIST')[0]);
        $this->assertSame('startup_list', $this->search('', 'startup-list')[0]);
    }

    /**
     * A near-miss is not resolved to its neighbour.
     *
     * `startup_lst` sits one character from `startup_list` and one concept from
     * `startup_set`. Guessing would turn a request to read into a request to
     * change, on the strength of a typo.
     */
    public function testATypoIsNotResolvedToANeighbouringTool(): void
    {
        $matches = $this->catalogue()->search($this->candidates(), '', 'startup_lst', 5);

        $this->assertSame([], $matches);
    }

    /**
     * An exact name outranks everything a query could score.
     *
     * The doc's hard rule. A model that named a tool has already done the
     * retrieval, and semantic similarity has no business overruling it.
     */
    public function testAnExactNameOutranksAStrongerQueryMatch(): void
    {
        $matches = $this->search('list the files in a directory', 'startup_list');

        $this->assertSame('startup_list', $matches[0]);
    }

    /*
    |--------------------------------------------------------------------------
    | Natural language
    |--------------------------------------------------------------------------
    */

    /**
     * The scenario the design document is written around.
     */
    public function testStartupCommandResolvesToStartupList(): void
    {
        $this->assertSame('startup_list', $this->search('startup command')[0]);
        $this->assertSame('startup_list', $this->search('read the startup command')[0]);
    }

    /**
     * The queries a person actually types, against the tool each should reach.
     *
     * Asserted as one test rather than a data provider so a regression reports
     * every intent it broke at once. Half of tuning retrieval is seeing which
     * queries moved together.
     */
    public function testAPlainDescriptionFindsTheRightTool(): void
    {
        $server = ToolDefinition::SCOPE_SERVER;
        $admin = ToolDefinition::SCOPE_ADMIN;

        $intents = [
            ['what port am i on', 'allocations_list', $server],
            ['do i have any backups', 'backups_list', $server],
            ['make a backup', 'backup_create', $server],
            ['restart the server', 'server_power', $server],
            ['edit the config file', 'files_write', $server],
            ['unzip a modpack', 'files_decompress', $server],
            ['what minecraft version is this', 'minecraft_server_info', $server],
            ['how much memory is it using', 'server_status', $server],
            ['delete a folder', 'files_delete', $server],
            ['scheduled restarts', 'schedules_list', $server],
            ['who bought what', 'admin_orders_list', $admin],
            ['change a price', 'admin_product_update', $admin],
            ['find a customer by email', 'admin_users_list', $admin],
            ['look at a customer server', 'admin_assist_server', $admin],
            ['open support tickets', 'admin_tickets_list', $admin],
            ['discount code', 'admin_coupons_list', $admin],
        ];

        $missed = [];

        foreach ($intents as [$query, $expected, $scope]) {
            $top = $this->search($query, null, $scope)[0] ?? '(nothing)';

            if ($top !== $expected) {
                $missed[] = sprintf('"%s" wanted %s, got %s', $query, $expected, $top);
            }
        }

        $this->assertSame([], $missed, "Retrieval missed:\n" . implode("\n", $missed));
    }

    /**
     * An ambiguous query surfaces the read before the write.
     *
     * "Do I have any backups" scores `backups_list` and `backup_create` alike on
     * tokens, and offering the model the one that creates something is how a
     * question turns into an action nobody asked for.
     */
    public function testAnAmbiguousQueryPrefersTheRead(): void
    {
        $this->assertSame('backups_list', $this->search('do i have any backups')[0]);
    }

    /**
     * The same query twice gives the same answer in the same order.
     */
    public function testRankingIsDeterministic(): void
    {
        $first = $this->search('files');

        for ($i = 0; $i < 3; ++$i) {
            $this->assertSame($first, $this->search('files'));
        }
    }

    /*
    |--------------------------------------------------------------------------
    | What search must never do
    |--------------------------------------------------------------------------
    */

    public function testNothingMatchesReturnsNothing(): void
    {
        $this->assertSame([], $this->search('reticulate the splines'));
    }

    /**
     * Search ranks what it is handed and filters nothing itself.
     *
     * Deliberate: reachability is decided by the same permission checks that
     * decide what is offered, one layer up, and a search index that made its own
     * decision would be a second, weaker authorization path.
     */
    public function testSearchOnlyEverReturnsCandidates(): void
    {
        $candidates = array_slice($this->candidates(), 0, 3);
        $names = array_map(fn (ToolDefinition $d) => $d->name, $candidates);

        foreach ($this->catalogue()->search($candidates, 'backup restart file startup', null, 8) as $match) {
            $this->assertContains($match->name(), $names);
        }
    }

    /**
     * A disabled tool is never advertised, even by exact name.
     *
     * Checked through the registry rather than by removing it from the candidate
     * list by hand, because the operator's disable list has to reach discovery
     * through the same route it reaches offering.
     */
    public function testADisabledToolIsNotACandidate(): void
    {
        $registry = $this->registry(disabled: ['startup_list']);

        $candidates = array_values(array_filter(
            $registry->all(),
            fn (ToolDefinition $d) => $d->inScope(ToolDefinition::SCOPE_SERVER)
                && !$registry->isDisabled($d->name),
        ));

        $matches = $this->catalogue($registry)->search($candidates, 'startup command', 'startup_list', 5);

        $this->assertNotContains('startup_list', array_map(fn ($m) => $m->name(), $matches));
    }

    /**
     * Every tool carries the metadata that makes it findable.
     *
     * The failure this guards is quiet and permanent: a tool added without
     * aliases works perfectly and is reachable only by somebody who already knows
     * its name — which, on a surface where the model is shown a fraction of the
     * catalogue, means effectively unreachable.
     */
    public function testEveryToolIsDiscoverable(): void
    {
        foreach ($this->registry()->all() as $definition) {
            $this->assertNotNull(
                $definition->discovery,
                $definition->name . ' has no discovery metadata, so nothing can find it.',
            );

            $this->assertNotEmpty(
                $definition->discovery->aliases,
                $definition->name . ' has no aliases, so only its exact name reaches it.',
            );

            $this->assertNotEmpty($definition->summary(), $definition->name . ' has no summary.');
        }
    }

    /**
     * Every tool is findable by describing it, not just by naming it.
     *
     * The end-to-end version of the test above: metadata can be present and still
     * be useless. Asserting only that each tool's own aliases reach it is a low
     * bar deliberately — it catches an alias that collides with a stronger tool's
     * name, which is the way this actually goes wrong.
     */
    public function testEveryToolIsReachableByItsOwnAliases(): void
    {
        $registry = $this->registry();

        foreach ($registry->all() as $definition) {
            if (in_array($definition->name, SharedTools::ALWAYS_OFFERED, true)) {
                continue;
            }

            $scope = $definition->scope === ToolDefinition::SCOPE_ADMIN
                ? ToolDefinition::SCOPE_ADMIN
                : ToolDefinition::SCOPE_SERVER;

            $reached = false;

            foreach ($definition->discovery->aliases as $alias) {
                if (in_array($definition->name, $this->search($alias, null, $scope), true)) {
                    $reached = true;
                    break;
                }
            }

            $this->assertTrue(
                $reached,
                sprintf(
                    '%s cannot be found by any of its own aliases (%s), so nothing else will find it either.',
                    $definition->name,
                    implode(', ', $definition->discovery->aliases),
                ),
            );
        }
    }
}
