<?php

namespace Everest\Tests\Unit\Http\Middleware\Api\Application;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\DB;
use Everest\Services\Acl\Api\AdminAcl;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Http\Controllers\Api\Application\Nodes\NodeController;
use Everest\Services\Authorization\ApplicationApiPermissionResolver;
use Everest\Http\Middleware\Api\Application\AuthorizeApplicationUser;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Everest\Http\Controllers\Api\Application\Settings\FeaturesController;

class AuthorizeApplicationUserTest extends TestCase
{
    private int $roleId;

    public function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('admin_roles')) {
            Schema::create('admin_roles', function (Blueprint $table) {
                $table->increments('id');
                $table->string('name');
                $table->string('description')->nullable();
                $table->integer('sort_id')->default(0);
                $table->json('permissions')->nullable();
                $table->string('color')->nullable();
            });
        }

        $this->roleId = DB::table('admin_roles')->insertGetId([
            'name' => 'authorization-test-' . bin2hex(random_bytes(4)),
            'sort_id' => 0,
            'permissions' => json_encode([AdminRole::SETTINGS_READ]),
        ]);
    }

    protected function tearDown(): void
    {
        DB::table('admin_roles')->where('id', $this->roleId)->delete();

        parent::tearDown();
    }

    public function testDelegatedAdminWithRequiredPermissionIsAllowed(): void
    {
        $request = $this->requestFor(
            User::factory()->make([
                'root_admin' => false,
                'admin_role_id' => $this->roleId,
            ]),
            FeaturesController::class,
            'index'
        );

        $called = false;
        $this->middleware()->handle($request, function () use (&$called) {
            $called = true;

            return 'next';
        });

        $this->assertTrue($called);
    }

    public function testDelegatedAdminWithoutRequiredPermissionIsDenied(): void
    {
        DB::table('admin_roles')->where('id', $this->roleId)->update([
            'permissions' => json_encode([AdminRole::USERS_READ]),
        ]);

        $this->expectException(AccessDeniedHttpException::class);

        $this->middleware()->handle(
            $this->requestFor(
                User::factory()->make([
                    'root_admin' => false,
                    'admin_role_id' => $this->roleId,
                ]),
                FeaturesController::class,
                'index'
            ),
            static fn () => 'next'
        );
    }

    public function testRootAdministratorStillFailsClosedForUndeclaredAction(): void
    {
        $this->expectException(AccessDeniedHttpException::class);

        $this->middleware()->handle(
            $this->requestFor(
                User::factory()->make(['root_admin' => true]),
                UndeclaredActionController::class,
                'index'
            ),
            static fn () => 'next'
        );
    }

    public function testRootAdministratorApplicationKeyIsStillResourceScoped(): void
    {
        $user = User::factory()->make(['root_admin' => true]);
        $user->withAccessToken(ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ,
        ]));

        $called = false;
        $this->middleware()->handle(
            $this->requestFor($user, NodeController::class, 'index', 'GET', '/api/application/nodes'),
            function () use (&$called) {
                $called = true;

                return 'next';
            }
        );
        $this->assertTrue($called);

        $this->expectException(AccessDeniedHttpException::class);
        $this->middleware()->handle(
            $this->requestFor($user, NodeController::class, 'update', 'PATCH', '/api/application/nodes/{node}'),
            static fn () => 'next'
        );
    }

    public function testLegacyApplicationKeyRetainsRoleOnlyAccess(): void
    {
        $user = User::factory()->make(['root_admin' => true]);
        $user->withAccessToken(ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => false,
            'r_nodes' => AdminAcl::NONE,
        ]));

        $called = false;
        $this->middleware()->handle(
            $this->requestFor($user, NodeController::class, 'update', 'PATCH', '/api/application/nodes/{node}'),
            function () use (&$called) {
                $called = true;

                return 'next';
            }
        );

        $this->assertTrue($called);
    }

    private function middleware(): AuthorizeApplicationUser
    {
        return new AuthorizeApplicationUser(new ApplicationApiPermissionResolver());
    }

    private function requestFor(
        User $user,
        string $controller,
        string $method,
        string $httpMethod = 'GET',
        string $uri = '/api/application/test',
    ): Request {
        $request = Request::create($uri, $httpMethod);
        $request->setUserResolver(static fn () => $user);
        $request->setRouteResolver(static fn () => new Route(
            [$httpMethod],
            $uri,
            [$controller, $method]
        ));

        return $request;
    }
}

class UndeclaredActionController
{
    public function index(Request $request): void
    {
    }
}
