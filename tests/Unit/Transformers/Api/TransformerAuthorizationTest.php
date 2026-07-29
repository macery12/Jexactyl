<?php

namespace Everest\Tests\Unit\Transformers\Api;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Transformers\Api\Transformer;

class TransformerAuthorizationTest extends TestCase
{
    public function testRootOwnedKeyStillScopesIncludedResources(): void
    {
        $user = User::factory()->make(['root_admin' => true]);
        $user->withAccessToken(ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ,
            'r_servers' => AdminAcl::NONE,
        ]));

        $request = Request::create('/api/application/servers', 'GET');
        $this->app->instance('request', $request);
        $this->app['request']->setUserResolver(static fn () => $user);

        $transformer = new ExposedAuthorizationTransformer();

        $this->assertTrue($transformer->allows(AdminAcl::RESOURCE_NODES));
        $this->assertFalse($transformer->allows(AdminAcl::RESOURCE_SERVERS));
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
