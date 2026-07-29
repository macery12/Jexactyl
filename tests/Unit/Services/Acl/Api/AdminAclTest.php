<?php

namespace Everest\Tests\Unit\Services\Acl\Api;

use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Laravel\Sanctum\TransientToken;
use Everest\Services\Acl\Api\AdminAcl;
use PHPUnit\Framework\Attributes\DataProvider;

class AdminAclTest extends TestCase
{
    /**
     * Test that permissions return the expects values.
     **/
    #[DataProvider('permissionsDataProvider')]
    public function testPermissions(int $permission, int $check, bool $outcome)
    {
        $this->assertSame($outcome, AdminAcl::can($permission, $check));
    }

    /**
     * Test that checking against a model works as expected.
     */
    public function testCheck()
    {
        $model = ApiKey::factory()->make(['r_servers' => AdminAcl::READ | AdminAcl::WRITE]);

        $this->assertTrue(AdminAcl::check($model, AdminAcl::RESOURCE_SERVERS, AdminAcl::WRITE));
    }

    public function testScopedApplicationKeyIsEnforced(): void
    {
        $key = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ,
        ]);

        $this->assertTrue(AdminAcl::keyPermits($key, AdminAcl::RESOURCE_NODES, AdminAcl::READ));
        $this->assertFalse(AdminAcl::keyPermits($key, AdminAcl::RESOURCE_NODES, AdminAcl::WRITE));
        $this->assertFalse(AdminAcl::keyPermits($key, 'unknown', AdminAcl::READ));
    }

    public function testLegacyKeyAndSessionTokenBypassResourceGate(): void
    {
        $legacy = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => false,
            'r_nodes' => AdminAcl::NONE,
        ]);

        $this->assertTrue(AdminAcl::keyPermits($legacy, AdminAcl::RESOURCE_NODES, AdminAcl::WRITE));
        $this->assertTrue(AdminAcl::keyPermits(new TransientToken(), AdminAcl::RESOURCE_NODES, AdminAcl::WRITE));
        $this->assertFalse(AdminAcl::keyPermits(null, AdminAcl::RESOURCE_NODES, AdminAcl::READ));
        $this->assertTrue(AdminAcl::keyPermits(null, null, AdminAcl::READ));
    }

    public function testScopedKeyCannotDelegateBroaderPermissions(): void
    {
        $key = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ,
            'r_servers' => AdminAcl::READ | AdminAcl::WRITE,
        ]);

        $this->assertTrue(AdminAcl::canDelegate($key, [
            'r_nodes' => AdminAcl::READ,
            'r_servers' => AdminAcl::READ,
        ]));
        $this->assertFalse(AdminAcl::canDelegate($key, [
            'r_nodes' => AdminAcl::READ | AdminAcl::WRITE,
        ]));
    }

    /**
     * Provide valid and invalid permissions combos for testing.
     */
    public static function permissionsDataProvider(): array
    {
        return [
            [AdminAcl::READ, AdminAcl::READ, true],
            [AdminAcl::READ | AdminAcl::WRITE, AdminAcl::READ, true],
            [AdminAcl::READ | AdminAcl::WRITE, AdminAcl::WRITE, true],
            [AdminAcl::WRITE, AdminAcl::WRITE, true],
            [AdminAcl::READ, AdminAcl::WRITE, false],
            [AdminAcl::NONE, AdminAcl::READ, false],
            [AdminAcl::NONE, AdminAcl::WRITE, false],
        ];
    }
}
