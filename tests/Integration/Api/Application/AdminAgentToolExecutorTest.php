<?php

namespace Everest\Tests\Integration\Api\Application;

use Everest\Models\Egg;
use Everest\Models\User;
use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Everest\Models\Billing\Product;
use Everest\Models\Billing\Category;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolExecutor;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolInvocation;
use Everest\Services\AI\Support\SchemaValidator;
use Everest\Services\AI\Tools\ConsoleCommandGate;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Tests\Traits\Integration\CreatesTestModels;

/**
 * The admin agent dispatching into the Application API.
 *
 * The bet is the same one the server agent makes: rather than re-implementing
 * authorization, every tool call traverses the identical middleware a browser
 * request does. On this surface that is `AuthenticateApplicationUser`, then
 * `AuthorizeApplicationUser`, then the endpoint's own
 * `ApplicationApiRequest::authorize()` — which checks the same capability a
 * second time.
 *
 * These tests exist because that claim is worth nothing unless it is exercised:
 * a delegated administrator must be refused, cleanly, on a tool they were never
 * entitled to run.
 */
class AdminAgentToolExecutorTest extends IntegrationTestCase
{
    use CreatesTestModels;

    // Deliberately no DatabaseTransactions: the executor refuses to dispatch
    // inside one, because the exception handler rolls back to level 0 when it
    // renders and would take the caller's transaction with it. Wrapping these
    // tests in a transaction would test the guard rather than the dispatch.

    private ToolExecutor $executor;

    private ToolRegistry $registry;

    /** @var int[] */
    private array $createdProductIds = [];

    /** @var int[] */
    private array $createdCategoryIds = [];

    public function setUp(): void
    {
        parent::setUp();

        $this->executor = $this->app->make(ToolExecutor::class);
        $this->registry = new ToolRegistry(
            new RiskGate(new ConsoleCommandGate()),
            new SchemaValidator(),
            $this->app->make(AdminAuthorizer::class),
        );
    }

    /**
     * Without a wrapping transaction, every user and role these tests create
     * survives into whatever runs next — and a listing test that counts rows
     * will fail somewhere far away from here.
     */
    protected function tearDown(): void
    {
        if ($this->createdProductIds !== []) {
            Product::query()->whereKey($this->createdProductIds)->forceDelete();
        }
        if ($this->createdCategoryIds !== []) {
            Category::query()->whereKey($this->createdCategoryIds)->forceDelete();
        }
        User::query()->forceDelete();
        AdminRole::query()->where('is_owner', false)->where('is_system', false)->forceDelete();

        parent::tearDown();
    }

    /**
     * An administrator holding exactly the listed capabilities, and no others.
     *
     * @param string[] $capabilities
     */
    private function delegatedAdmin(array $capabilities): User
    {
        // `is_owner` is not fillable, and rightly so — an Access Profile cannot
        // be promoted to owner through mass assignment anywhere in the panel.
        $role = new AdminRole();
        $role->forceFill([
            'name' => 'Delegated ' . uniqid(),
            'sort_id' => AdminRole::query()->max('sort_id') + 1,
            'permissions' => $capabilities,
            'is_owner' => false,
            'is_system' => false,
            'api_eligible' => false,
        ])->save();

        return User::factory()->create(['admin_role_id' => $role->id, 'root_admin' => false]);
    }

    private function owner(): User
    {
        $role = AdminRole::query()->where('is_owner', true)->firstOrFail();

        return User::factory()->create(['admin_role_id' => $role->id, 'root_admin' => true]);
    }

    /**
     * Stand in for the streaming controller: a resolved, session-authenticated
     * parent request, which is the state the executor runs inside. Session
     * rather than API key on purpose — the admin assistant is driven from a
     * browser, and the two authenticate down different branches.
     */
    private function actAsParentRequest(User $user): void
    {
        $this->actingAs($user);

        $parent = Request::create('http://localhost/api/application/ai/agent', 'POST');
        $parent->setUserResolver(fn () => $user);

        $this->app->instance('request', $parent);
    }

    private function tool(string $tool, string $method, string $uri, array $body = []): \Everest\Services\AI\Tools\ToolResult
    {
        return $this->executor->execute(new ToolInvocation($tool, $method, $uri, [], $body));
    }

    private function populatedProduct(): Product
    {
        $egg = Egg::query()->firstOrFail();
        $category = Category::query()->create([
            'uuid' => \Ramsey\Uuid\Uuid::uuid4()->toString(),
            'name' => 'Agent remediation fixture ' . uniqid(),
            'visible' => true,
            'nest_id' => $egg->nest_id,
            'egg_id' => $egg->id,
            'allowed_eggs' => [$egg->id],
            'allow_egg_changes' => false,
            'allow_plan_changes' => false,
        ]);
        $this->createdCategoryIds[] = $category->id;

        $product = new Product();
        $product->forceFill([
            'uuid' => \Ramsey\Uuid\Uuid::uuid4()->toString(),
            'category_uuid' => $category->uuid,
            'name' => 'Original plan',
            'icon' => 'box',
            'price' => 12.75,
            'description' => 'Original description',
            'visible' => false,
            'cpu_limit' => 250,
            'memory_limit' => 4096,
            'disk_limit' => 8192,
            'backup_limit' => 4,
            'database_limit' => 5,
            'allocation_limit' => 6,
            'subdomain_limit' => 7,
        ])->save();
        $this->createdProductIds[] = $product->id;

        return $product->fresh();
    }

    private function invokeDefinition(string $name, array $arguments): \Everest\Services\AI\Tools\ToolResult
    {
        $definition = $this->registry->find($name);
        $this->assertNotNull($definition);

        $validated = $this->registry->validate($definition, $arguments);
        $this->assertTrue($validated['valid'], implode(' ', $validated['errors']));

        return $this->executor->execute($definition->invoke(
            $validated['value'],
            $this->registry->contextForTool($definition, null, $validated['value']),
        ));
    }

    /*
    |--------------------------------------------------------------------------
    | Capabilities
    |--------------------------------------------------------------------------
    */

    public function testAnAdminWithoutTheCapabilityGetsAForbiddenToolErrorNotData(): void
    {
        $this->actAsParentRequest($this->delegatedAdmin([AdminRole::AI_READ]));

        $result = $this->tool('admin_users_list', 'GET', '/api/application/users');

        $this->assertFalse($result->ok);
        $this->assertSame(403, $result->status);
        // Not retryable: rephrasing will not grant a permission, and a model
        // that keeps trying burns the turn.
        $this->assertFalse($result->retryable);
        $this->assertSame('forbidden', $result->code);
    }

    public function testTheSameCallSucceedsForAnAdminWhoHoldsIt(): void
    {
        $this->actAsParentRequest($this->delegatedAdmin([AdminRole::AI_READ, AdminRole::USERS_READ]));

        $result = $this->tool('admin_users_list', 'GET', '/api/application/users');

        $this->assertTrue($result->ok, 'Expected a listing, got: ' . $result->summary());
    }

    public function testAnOwnerIsNotBlockedByTheCapabilityCheck(): void
    {
        $this->actAsParentRequest($this->owner());

        $this->assertTrue($this->tool('admin_users_list', 'GET', '/api/application/users')->ok);
    }

    /**
     * Read access to the catalogue must not carry write access to it. This is
     * the split the whole v1 scope rests on.
     */
    public function testReadAccessDoesNotImplyWriteAccess(): void
    {
        $this->actAsParentRequest($this->delegatedAdmin([AdminRole::AI_READ, AdminRole::BILLING_READ]));

        $this->assertTrue($this->tool('admin_categories_list', 'GET', '/api/application/billing/categories')->ok);

        $created = $this->tool('admin_product_create', 'POST', '/api/application/billing/categories/1/products', [
            'name' => 'Should not exist',
            'price' => 1,
        ]);

        $this->assertFalse($created->ok);
        $this->assertSame(403, $created->status);
    }

    public function testProductToolNameOnlyPatchPreservesEveryOmittedColumn(): void
    {
        $this->actAsParentRequest($this->owner());
        $product = $this->populatedProduct();
        $before = $product->getRawOriginal();

        $result = $this->invokeDefinition('admin_product_update', [
            'category' => (string) $product->category->id,
            'product' => (string) $product->id,
            'name' => 'Renamed plan',
        ]);

        $this->assertTrue($result->ok, $result->summary());
        $after = $product->refresh()->getRawOriginal();
        $this->assertSame('Renamed plan', $after['name']);

        foreach ($before as $column => $value) {
            if (in_array($column, ['name', 'updated_at'], true)) {
                continue;
            }
            $this->assertSame($value, $after[$column], "Omitted column {$column} changed.");
        }
    }

    public function testProductToolPreservesExplicitNullAndZeroMeanings(): void
    {
        $this->actAsParentRequest($this->owner());
        $product = $this->populatedProduct();

        $result = $this->invokeDefinition('admin_product_update', [
            'category' => (string) $product->category->id,
            'product' => (string) $product->id,
            'description' => null,
            'icon' => null,
            'price' => 0,
            'backup_limit' => 0,
            'subdomain_limit' => null,
        ]);

        $this->assertTrue($result->ok, $result->summary());
        $product->refresh();
        $this->assertNull($product->description);
        $this->assertNull($product->icon);
        $this->assertSame(0.0, $product->price);
        $this->assertSame(0, $product->backup_limit);
        $this->assertNull($product->subdomain_limit);
        $this->assertSame(4096, $product->memory_limit);
    }

    /*
    |--------------------------------------------------------------------------
    | Containment
    |--------------------------------------------------------------------------
    */

    /**
     * The registry is the allowlist. An endpoint that is genuinely reachable by
     * a browser must still be unreachable as a tool unless somebody registered
     * it — this is what keeps role editing, node management and API keys out of
     * the agent's hands regardless of who is driving it.
     */
    public function testHighRiskEndpointsAreNotRegisteredAsTools(): void
    {
        $uris = array_map(fn ($d) => $d->uriTemplate, AdminTools::all());

        foreach ([
            '/api/application/roles',
            '/api/application/nodes',
            '/api/application/eggs',
            '/api/application/nests',
            '/api/application/api-keys',
            '/api/application/billing/keys',
            '/api/application/extensions',
        ] as $forbidden) {
            foreach ($uris as $uri) {
                $this->assertStringNotContainsString(
                    $forbidden,
                    $uri,
                    sprintf('%s is registered as a tool but is meant to be out of reach.', $forbidden)
                );
            }
        }
    }

    /**
     * No admin tool may delete. The surface has no typed-confirmation path, so
     * a delete would ride in behind an ordinary approval card.
     */
    public function testNoAdminToolUsesADestructiveMethod(): void
    {
        foreach (AdminTools::all() as $definition) {
            $this->assertNotSame('DELETE', strtoupper($definition->method), $definition->name);
            $this->assertStringNotContainsString('/delete', $definition->uriTemplate, $definition->name);
            $this->assertStringNotContainsString('/suspend', $definition->uriTemplate, $definition->name);
            $this->assertStringNotContainsString('/reinstall', $definition->uriTemplate, $definition->name);
            $this->assertStringNotContainsString('/transfer', $definition->uriTemplate, $definition->name);
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Executor invariants, on this surface
    |--------------------------------------------------------------------------
    */

    public function testTheParentRequestIsRestoredAfterDispatch(): void
    {
        $this->actAsParentRequest($this->owner());

        $before = $this->app->make('request');
        $this->tool('admin_users_list', 'GET', '/api/application/users');

        $this->assertSame($before, $this->app->make('request'));
    }

    /**
     * `Route::getController()` memoises onto the process-shared Route, and the
     * Application API controllers call Fractal's `parseIncludes()` in their
     * constructor — which accumulates. One tool's `?include=` would otherwise
     * leak into every later call on the same route.
     */
    public function testFractalIncludesDoNotLeakBetweenToolCalls(): void
    {
        $this->actAsParentRequest($this->owner());

        $withIncludes = $this->tool('admin_servers_list', 'GET', '/api/application/servers?include=allocations');
        $this->assertTrue($withIncludes->ok);

        $plain = $this->tool('admin_servers_list', 'GET', '/api/application/servers');
        $this->assertTrue($plain->ok);

        $this->assertStringNotContainsString('allocations', json_encode($plain->data) ?: '');
    }

    /**
     * `convertExceptionToArray()` injects file paths and a full stack trace when
     * APP_DEBUG is on. That would be echoed into the model's context and out to
     * the administrator's screen over SSE.
     */
    public function testInternalDetailNeverReachesTheModelEvenWithDebugOn(): void
    {
        config()->set('app.debug', true);

        $this->actAsParentRequest($this->delegatedAdmin([AdminRole::AI_READ]));

        $result = $this->tool('admin_users_list', 'GET', '/api/application/users');
        $payload = $result->toModelPayload();

        $this->assertStringNotContainsString('trace', $payload);
        $this->assertStringNotContainsString('/var/www', $payload);
        $this->assertStringNotContainsString('Exception', $payload);
    }

    /**
     * The `api.application` limiter gives agent traffic its own bounded budget
     * rather than spending the human's — one question can be a dozen
     * sub-requests, and charging them to the browser session would let a single
     * assistant answer exhaust the administrator's own allowance.
     *
     * The marker is checked here rather than only on the client limiter because
     * an admin turn is the traffic that actually crosses this one.
     */
    public function testAgentTrafficIsIdentifiableAndTheMarkerCannotBeForged(): void
    {
        $limiter = $this->app->make(\Illuminate\Cache\RateLimiter::class)->limiter('api.application');
        $this->assertNotNull($limiter, 'The api.application limiter is not registered.');

        $plain = Request::create('/api/application/users', 'GET');
        $this->assertFalse(ToolExecutor::isInternal($plain));

        // Unforgeable: the marker is an object identity in the server-side
        // attribute bag, which nothing on the wire can populate.
        $spoofed = Request::create('/api/application/users', 'GET', [
            'everest.ai.internal_tool_call' => true,
        ]);
        $spoofed->headers->set('everest.ai.internal_tool_call', '1');
        $this->assertFalse(ToolExecutor::isInternal($spoofed));
    }
}
