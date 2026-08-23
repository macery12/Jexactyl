<?php

namespace Everest\Tests\Unit\Services\Authorization;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Illuminate\Routing\Route;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Http\Requests\Api\Client\ClientApiRequest;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;
use Everest\Http\Requests\Api\Application\Theme\GetThemeRequest;
use Everest\Http\Requests\Api\Application\Alerts\GetAlertsRequest;
use Everest\Http\Controllers\Api\Application\PermissionsController;
use Everest\Http\Requests\Api\Application\Theme\UpdateThemeRequest;
use Everest\Http\Controllers\Api\Application\Alerts\AlertController;
use Everest\Http\Controllers\Api\Application\IntelligenceController;
use Everest\Services\Authorization\ApplicationApiPermissionResolver;
use Everest\Http\Controllers\Api\Application\Billing\StoreController;
use Everest\Http\Requests\Api\Application\Servers\ServerWriteRequest;
use Everest\Http\Requests\Api\Application\Settings\FinishSetupRequest;
use Everest\Http\Controllers\Api\Application\Billing\InvoiceController;
use Everest\Http\Requests\Api\Application\Intelligence\ProbeToolCallingRequest;
use Everest\Http\Requests\Api\Application\Billing\CustomDomains\UpdateCustomDomainRequest;

class ApplicationApiPermissionResolverTest extends TestCase
{
    /**
     * Capabilities that gate something other than an Application API route.
     *
     * The invariant below exists to catch a capability that can be granted in
     * the UI and then does nothing — an orphan. `servers.assist` is not one: it
     * gates whether the AI assistant may open an audited session inside a
     * customer's server, which is enforced in `AssistAuthorizer` and consulted by
     * `AuthenticateServerAccess` and `ServerPolicy`. There is no endpoint behind
     * it because it does not add an endpoint; it decides whether the client API
     * routes that already exist will admit somebody who is neither the owner nor
     * a panel Owner.
     *
     * Listed explicitly rather than loosening the assertion, so a genuine orphan
     * still fails.
     */
    private const NON_ROUTE_CAPABILITIES = [AdminRole::SERVERS_ASSIST];

    public function testEveryRegisteredApplicationApiActionHasAnExplicitDeclaration(): void
    {
        $resolver = new ApplicationApiPermissionResolver();
        $failures = [];
        $usedCapabilities = [];
        $checked = 0;

        foreach ($this->app['router']->getRoutes()->getRoutes() as $route) {
            if (!str_starts_with($route->uri(), 'api/application')) {
                continue;
            }

            ++$checked;
            try {
                $capability = $resolver->permissionFor($route);
                if ($capability !== null) {
                    $usedCapabilities[$capability] = true;
                }
            } catch (\Throwable $exception) {
                $failures[] = $route->getActionName() . ': ' . $exception->getMessage();
            }
        }

        $this->assertGreaterThan(100, $checked, 'Expected the Application API route file to be loaded.');
        $this->assertSame([], $failures);
        $this->assertEqualsCanonicalizing(
            array_values(array_diff(app(AdminCapabilityRegistry::class)->all(), self::NON_ROUTE_CAPABILITIES)),
            array_keys($usedCapabilities),
            'Every assignable capability must protect at least one live Application API action.'
        );
    }

    public function testAuthenticationOnlyAllowlistIsSmallAndExplicit(): void
    {
        $resolver = new ApplicationApiPermissionResolver();

        $this->assertSame(
            [PermissionsController::class . '@__invoke'],
            $resolver->authenticationOnlyActions()
        );
        $this->assertNull($resolver->permissionFor(
            new Route(['GET'], '/permissions', [PermissionsController::class, '__invoke'])
        ));
    }

    public function testSensitivePreviouslyPlainActionsResolveToExactPermissions(): void
    {
        $resolver = new ApplicationApiPermissionResolver();

        $this->assertSame(
            AdminRole::BILLING_READ,
            $resolver->permissionFor($this->route(StoreController::class, 'index'))
        );
        $this->assertSame(
            AdminRole::BILLING_ORDERS,
            $resolver->permissionFor($this->route(InvoiceController::class, 'show'))
        );
        $this->assertSame(
            AdminRole::BILLING_UPDATE,
            $resolver->permissionFor($this->route(InvoiceController::class, 'void', 'POST'))
        );
        $this->assertSame(
            AdminRole::AI_READ,
            $resolver->permissionFor($this->route(IntelligenceController::class, 'recentLogs'))
        );
        $this->assertSame(
            AdminRole::ALERTS_UPDATE,
            $resolver->permissionFor($this->route(AlertController::class, 'searchUsers'))
        );
    }

    public function testCorrectedActionRequestsUseTheirDedicatedPermissions(): void
    {
        $this->assertSame(AdminRole::SETTINGS_UPDATE, (new FinishSetupRequest())->permission());
        $this->assertSame(AdminRole::CUSTOM_DOMAINS_UPDATE, (new UpdateCustomDomainRequest())->permission());
        $this->assertSame(AdminRole::ALERTS_READ, (new GetAlertsRequest())->permission());
        $this->assertSame(AdminRole::THEME_READ, (new GetThemeRequest())->permission());
        $this->assertSame(AdminRole::THEME_UPDATE, (new UpdateThemeRequest())->permission());
        $this->assertSame(AdminRole::SERVERS_UPDATE, (new ServerWriteRequest())->permission());
        $this->assertSame(AdminRole::AI_UPDATE, (new ProbeToolCallingRequest())->permission());
    }

    public function testPlainRequestActionFailsClosed(): void
    {
        $this->expectException(\LogicException::class);

        (new ApplicationApiPermissionResolver())->permissionFor(
            $this->route(PlainRequestController::class, 'index')
        );
    }

    public function testPermissionlessApplicationRequestFailsClosed(): void
    {
        $this->expectException(\LogicException::class);

        (new ApplicationApiPermissionResolver())->permissionFor(
            $this->route(PermissionlessRequestController::class, 'index')
        );
    }

    public function testClientApiRequestHierarchyRemainsConcrete(): void
    {
        $this->assertInstanceOf(ClientApiRequest::class, new ConcreteClientApiRequest());
    }

    public function testPermissionlessApplicationRequestDeniesEvenRootUser(): void
    {
        $request = new PermissionlessApplicationRequest();
        $request->setUserResolver(static fn () => User::factory()->make([
            'root_admin' => true,
            'state' => null,
        ]));

        $this->assertFalse($request->authorize());
    }

    public function testKeyScopeUsesExactNestedResourcesAndHttpMethod(): void
    {
        $resolver = new ApplicationApiPermissionResolver();

        $this->assertSame([
            'resource' => AdminAcl::RESOURCE_ALLOCATIONS,
            'action' => AdminAcl::READ,
        ], $resolver->scopeFor(
            new Route(['GET'], '/api/application/nodes/{node}/allocations', static fn () => null),
            AdminRole::NODES_READ
        ));

        $this->assertSame([
            'resource' => AdminAcl::RESOURCE_SERVER_DATABASES,
            'action' => AdminAcl::WRITE,
        ], $resolver->scopeFor(
            new Route(['POST'], '/api/application/servers/{server}/databases', static fn () => null),
            AdminRole::SERVERS_UPDATE
        ));

        $this->assertSame([
            'resource' => AdminAcl::RESOURCE_EGGS,
            'action' => AdminAcl::READ,
        ], $resolver->scopeFor(
            new Route(['GET'], '/api/application/eggs/{egg}/export', static fn () => null),
            AdminRole::EGGS_EXPORT
        ));
    }

    public function testKeyScopeLeavesModulesOutsideLegacyVocabularyRoleOnly(): void
    {
        $this->assertNull((new ApplicationApiPermissionResolver())->scopeFor(
            new Route(['PATCH'], '/api/application/settings', static fn () => null),
            AdminRole::SETTINGS_UPDATE
        ));
    }

    private function route(string $controller, string $method, string $httpMethod = 'GET'): Route
    {
        return new Route([$httpMethod], '/test', [$controller, $method]);
    }
}

class PlainRequestController
{
    public function index(Request $request): void
    {
    }
}

class PermissionlessApplicationRequest extends ApplicationApiRequest
{
}

class PermissionlessRequestController
{
    public function index(PermissionlessApplicationRequest $request): void
    {
    }
}

class ConcreteClientApiRequest extends ClientApiRequest
{
}
