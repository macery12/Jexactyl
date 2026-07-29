<?php

namespace Everest\Tests\Unit\Transformers\Api;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\AdminRole;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Transformers\Api\Transformer;
use Everest\Transformers\Api\Application\ServerDatabaseTransformer;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

class TransformerAuthorizationTest extends TestCase
{
    public function testKeyProfileScopesIncludedResourcesIndependentlyOfCreator(): void
    {
        $user = User::factory()->make(['root_admin' => true]);
        $profile = new AdminRole();
        $profile->forceFill([
            'id' => 123,
            'permissions' => [AdminRole::NODES_READ],
            'is_owner' => false,
            'api_eligible' => true,
        ]);
        $key = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'admin_role_id' => $profile->id,
        ]);
        $key->setRelation('accessProfile', $profile);
        $user->withAccessToken($key);

        $request = Request::create('/api/application/servers', 'GET');
        $this->app->instance('request', $request);
        $this->app['request']->setUserResolver(static fn () => $user);

        $transformer = new ExposedAuthorizationTransformer();

        $this->assertTrue($transformer->allows(AdminAcl::RESOURCE_NODES));
        $this->assertFalse($transformer->allows(AdminAcl::RESOURCE_SERVERS));
    }

    public function testOwnerCreatorDoesNotBypassKeyProfileForDatabasePasswords(): void
    {
        $owner = new AdminRole();
        $owner->forceFill(['id' => 1, 'is_owner' => true, 'api_eligible' => false]);

        $user = User::factory()->make(['admin_role_id' => $owner->id]);
        $user->setRelation('adminRole', $owner);

        $profile = new AdminRole();
        $profile->forceFill([
            'id' => 123,
            'permissions' => [AdminRole::SERVER_DATABASES_READ],
            'is_owner' => false,
            'api_eligible' => true,
        ]);
        $key = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'admin_role_id' => $profile->id,
        ]);
        $key->setRelation('accessProfile', $profile);
        $user->withAccessToken($key);

        $request = Request::create('/api/application/servers/1/databases', 'GET');
        $this->app->instance('request', $request);
        $this->app['request']->setUserResolver(static fn () => $user);

        $method = new \ReflectionMethod(ServerDatabaseTransformer::class, 'canViewPassword');

        $this->assertFalse($method->invoke(new ServerDatabaseTransformer()));

        $profile->permissions = [AdminRole::SERVER_DATABASES_READ, AdminRole::DATABASES_READ];

        $this->assertTrue(
            app(ApplicationApiAccessProfileService::class)->allows($key, AdminRole::DATABASES_READ)
        );
        $this->assertTrue($method->invoke(new ServerDatabaseTransformer()));
    }
}

class ExposedAuthorizationTransformer extends Transformer
{
    public function getResourceName(): string
    {
        return 'test';
    }

    public function allows(string $resource): bool
    {
        return $this->authorize($resource);
    }
}
