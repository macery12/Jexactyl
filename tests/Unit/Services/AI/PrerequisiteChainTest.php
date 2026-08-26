<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\User;
use Everest\Models\Server;
use Everest\Tests\TestCase;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Agent\WorkingSet;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Tools\Prerequisite;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Agent\AssistBinding;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Agent\WorkingSetPlanner;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Services\AI\Agent\PrerequisiteResolver;
use Everest\Services\Authorization\AdminAuthorizer;

/**
 * The chain a model cannot infer.
 *
 * An administrator asked to read a customer's startup command needs a resolved
 * server, then an approved read-only session, and only then the tool they
 * actually wanted. Every step of that is obvious afterwards and invisible in
 * advance, and the failure without it is not a wrong call — it is a confident
 * report that the panel cannot read startup commands.
 *
 * The other half of what these check is that making a tool *discoverable* never
 * makes it *usable*. A declaration says what to do next; `AssistAuthorizer` and
 * the approval card decide whether it happens.
 */
class PrerequisiteChainTest extends TestCase
{
    private function registry(): ToolRegistry
    {
        $authorizer = \Mockery::mock(AdminAuthorizer::class);
        $authorizer->shouldReceive('hasCapability')->andReturn(true);
        $authorizer->shouldReceive('isOwner')->andReturn(true);

        return new ToolRegistry(new RiskGate(new ConsoleCommandGate()), new SchemaValidator(), $authorizer);
    }

    private function user(): User
    {
        $user = \Mockery::mock(User::class)->makePartial();
        $user->shouldReceive('can')->andReturn(true);
        $user->id = 7;

        return $user;
    }

    private function server(): Server
    {
        $server = new Server();
        $server->uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        $server->name = 'Sponge-6842';

        return $server;
    }

    private function resolver(): PrerequisiteResolver
    {
        return new PrerequisiteResolver();
    }

    private function definition(string $name): ToolDefinition
    {
        return $this->registry()->find($name);
    }

    private function adminContext(?AssistBinding $binding = null): AgentContext
    {
        $context = new AgentContext($this->user(), null, 'turn-prereq');

        if ($binding !== null) {
            $context->bindAssist($binding, $this->server());
        }

        return $context;
    }

    private function binding(bool $writable = false, ?int $ticket = null): AssistBinding
    {
        return new AssistBinding(
            serverUuid: $this->server()->uuid,
            serverName: $this->server()->name,
            reason: 'Ticket 12 says the server will not boot.',
            abilities: $writable
                ? array_merge(AssistBinding::READ_ABILITIES, AssistBinding::WRITE_ABILITIES)
                : AssistBinding::READ_ABILITIES,
            ticketId: $ticket,
            writable: $writable,
        );
    }

    /*
    |--------------------------------------------------------------------------
    | The server surface has no chain
    |--------------------------------------------------------------------------
    */

    /**
     * A customer's own assistant is already on their server.
     */
    public function testAServerTurnNeedsNothingToReadItsOwnServer(): void
    {
        $context = new AgentContext($this->user(), $this->server(), 'turn-server');

        $this->assertSame([], $this->resolver()->unmet($context, $this->definition('startup_list')));
        $this->assertTrue($this->resolver()->availableNow($context, $this->definition('files_write')));
    }

    /*
    |--------------------------------------------------------------------------
    | The admin surface, the doc's scenario
    |--------------------------------------------------------------------------
    */

    /**
     * The chain is reported outermost first, so acting on entry one is always
     * the right move.
     */
    public function testAnAdminNeedsAServerAndASessionBeforeReadingStartup(): void
    {
        $unmet = $this->resolver()->unmet($this->adminContext(), $this->definition('startup_list'));

        $this->assertSame(
            [Prerequisite::SELECTED_SERVER, Prerequisite::READ_ASSIST],
            array_column($unmet, 'prerequisite'),
        );

        $this->assertSame('admin_servers_list', $unmet[0]['tool']);
        $this->assertSame('admin_assist_server', $unmet[1]['tool']);
    }

    /**
     * A write needs the escalation as well, and it comes last.
     */
    public function testAWriteAlsoNeedsTheEscalation(): void
    {
        $unmet = $this->resolver()->unmet($this->adminContext(), $this->definition('startup_set'));

        $this->assertSame(
            [Prerequisite::SELECTED_SERVER, Prerequisite::READ_ASSIST, Prerequisite::WRITE_ASSIST],
            array_column($unmet, 'prerequisite'),
        );

        $this->assertSame('admin_assist_allow_writes', end($unmet)['tool']);
    }

    /**
     * An approved read session clears the reads and leaves the writes standing.
     */
    public function testAReadSessionSatisfiesReadsOnly(): void
    {
        $context = $this->adminContext($this->binding());

        $this->assertTrue($this->resolver()->availableNow($context, $this->definition('startup_list')));
        $this->assertFalse($this->resolver()->availableNow($context, $this->definition('startup_set')));

        $unmet = $this->resolver()->unmet($context, $this->definition('startup_set'));
        $this->assertSame([Prerequisite::WRITE_ASSIST], array_column($unmet, 'prerequisite'));
    }

    public function testAWritableSessionSatisfiesWrites(): void
    {
        $context = $this->adminContext($this->binding(writable: true));

        $this->assertTrue($this->resolver()->availableNow($context, $this->definition('startup_set')));
    }

    /**
     * A ticket reader needs a session that was opened against a ticket.
     *
     * The one prerequisite declared on a definition rather than derived. Without
     * it, a ticket id lifted from untrusted customer text would look like an
     * ordinary automatic read of somebody else's conversation.
     */
    public function testTicketMessagesNeedATicketSubject(): void
    {
        $withoutTicket = $this->adminContext($this->binding());
        $withTicket = $this->adminContext($this->binding(ticket: 12));

        $this->assertFalse(
            $this->resolver()->availableNow($withoutTicket, $this->definition('admin_ticket_messages')),
        );
        $this->assertTrue(
            $this->resolver()->availableNow($withTicket, $this->definition('admin_ticket_messages')),
        );
    }

    /**
     * ...and only a subject. Outside a session there is nothing to stray from.
     *
     * Requiring one unconditionally was not a boundary, it was a cycle. The
     * `tickets` table has no body column, so everything a customer wrote lives
     * in `ticket_messages`; a ticket whose `server_id` is null names its server
     * only in that conversation. The agent therefore had to open an approved
     * session on the server it was trying to identify from the conversation it
     * could not read — and what that looked like from outside was an assistant
     * that listed tickets over and over and never learned what any said.
     *
     * The listing and the view are already unrestricted here under the same
     * `tickets.read` capability, so gating the one tool that carries the text
     * bought nothing either.
     */
    public function testTicketMessagesAreReadableOnTheAdminSurfaceWithNoSessionOpen(): void
    {
        $this->assertTrue(
            $this->resolver()->availableNow($this->adminContext(), $this->definition('admin_ticket_messages')),
        );

        // The tool that carries the text must be offered wherever the tool that
        // proves the ticket exists is. A set with one and not the other is the
        // deadlock in a different place.
        $this->assertContains('admin_ticket_messages', WorkingSet::PREFERRED[WorkingSet::PHASE_ADMIN]);
        $this->assertContains('admin_ticket_view', WorkingSet::PREFERRED[WorkingSet::PHASE_ADMIN]);
    }

    /*
    |--------------------------------------------------------------------------
    | Discoverable is not usable
    |--------------------------------------------------------------------------
    */

    /**
     * The full scenario from the design document, walked one transition at a
     * time — and at each step the target is *pinned but not offered* until the
     * transition that makes it real has actually happened.
     */
    public function testTheStartupCommandScenarioUnlocksInOrder(): void
    {
        $planner = new WorkingSetPlanner($this->registry(), $this->resolver());

        $context = $this->adminContext();
        $context->pin('startup_list', 'the administrator asked for a startup command');

        // Before any session: the target is held, the gateway is offered.
        $offered = $planner->plan($context, 12)->names();
        $this->assertNotContains('startup_list', $offered);
        $this->assertContains('admin_assist_server', $offered);
        $this->assertContains('startup_list', $context->pinned, 'The target must survive as a pin.');

        // After approval: the phase flips and the target becomes callable.
        $context->bindAssist($this->binding(), $this->server());
        $this->assertSame(WorkingSet::PHASE_READ_ASSIST, $context->phase);

        $offered = $planner->plan($context, 12)->names();
        $this->assertContains('startup_list', $offered);
    }

    /**
     * A read session never offers a mutation, whatever is pinned.
     */
    public function testAReadSessionNeverOffersAMutation(): void
    {
        $planner = new WorkingSetPlanner($this->registry(), $this->resolver());

        $context = $this->adminContext($this->binding());
        $context->pin('files_write', 'the model would like to fix it');
        $context->pin('server_power', 'and restart it');

        $offered = $planner->plan($context, 20)->names();

        $this->assertNotContains('files_write', $offered);
        $this->assertNotContains('server_power', $offered);
        $this->assertContains('admin_assist_allow_writes', $offered, 'The way to ask has to be visible.');
    }

    /**
     * Entering a session drops the panel browsing the turn was doing before.
     *
     * The property cumulative groups could not have: they only ever grew, so a
     * turn that had looked at billing carried the product catalogue into somebody
     * else's server for the rest of its life.
     */
    public function testEnteringASessionReleasesTheRetrievedPanelTools(): void
    {
        $context = $this->adminContext();
        $context->setRetrieved(['admin_products_list', 'admin_orders_list']);

        $context->bindAssist($this->binding(), $this->server());

        $this->assertSame([], $context->retrieved);
    }

    /**
     * A phase change counts as progress, so the repeat guard does not fire on a
     * call that is genuinely worth making again.
     */
    public function testAPhaseChangeBumpsTheStateVersion(): void
    {
        $context = $this->adminContext();
        $before = $context->stateVersion;

        $context->bindAssist($this->binding(), $this->server());

        $this->assertGreaterThan($before, $context->stateVersion);
    }
}
