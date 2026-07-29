<?php

namespace Everest\Tests\Integration\Api\Application\Api;

use Everest\Models\ApiKey;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Tests\Integration\Api\Application\ApplicationApiIntegrationTestCase;

class ApiKeyControllerTest extends ApplicationApiIntegrationTestCase
{
    public function testCreatesAndDisplaysScopedApplicationKey(): void
    {
        $permissions = $this->permissions([
            AdminAcl::RESOURCE_NODES => 'read',
            AdminAcl::RESOURCE_SERVERS => 'write',
        ]);

        $response = $this->postJson('/api/application/api', [
            'memo' => 'Scoped integration key',
            'permissions' => $permissions,
        ]);

        $response->assertOk()->assertJsonStructure(['token']);
        $this->assertDatabaseHas('api_keys', [
            'memo' => 'Scoped integration key',
            'key_type' => ApiKey::TYPE_APPLICATION,
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ,
            'r_servers' => AdminAcl::READ | AdminAcl::WRITE,
            'r_users' => AdminAcl::NONE,
        ]);

        $this->getJson('/api/application/api')
            ->assertOk()
            ->assertJsonFragment([
                'legacy' => false,
                'permissions' => $permissions,
            ]);
    }

    public function testReadOnlyRootOwnedKeyCannotWriteNodesOrDelegateWrite(): void
    {
        $this->createNewDefaultApiKey($this->getApiUser(), [
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ,
        ]);

        $this->getJson('/api/application/nodes')->assertOk();
        $this->postJson('/api/application/nodes', [])->assertForbidden();

        $this->postJson('/api/application/api', [
            'memo' => 'Broader delegated key',
            'permissions' => $this->permissions([AdminAcl::RESOURCE_NODES => 'write']),
        ])->assertForbidden();
    }

    public function testLegacyAllZeroKeyRetainsRoleOnlyAccess(): void
    {
        $this->createNewDefaultApiKey($this->getApiUser(), [
            'acl_enforced' => false,
            'r_nodes' => AdminAcl::NONE,
        ]);

        $this->getJson('/api/application/nodes')->assertOk();
    }

    public function testHistoricalNumericPermissionContractIsAccepted(): void
    {
        $permissions = [];
        foreach (AdminAcl::getResourceList() as $resource) {
            $permissions[AdminAcl::COLUMN_IDENTIFIER . $resource] = $resource === AdminAcl::RESOURCE_NODES ? '2' : '0';
        }

        $this->postJson('/api/application/api', [
            'memo' => 'Historical contract key',
            'permissions' => $permissions,
        ])->assertOk();

        $this->assertDatabaseHas('api_keys', [
            'memo' => 'Historical contract key',
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::READ | AdminAcl::WRITE,
        ]);
    }

    public function testDeleteEndpointCannotDeleteClientKeyById(): void
    {
        $clientKey = ApiKey::factory()->create([
            'user_id' => $this->getApiUser()->id,
            'key_type' => ApiKey::TYPE_ACCOUNT,
        ]);

        $this->assertDatabaseHas('api_keys', ['id' => $clientKey->getKey()]);
        $this->deleteJson('/api/application/api/' . $clientKey->getKey())->assertNotFound();
        $this->assertDatabaseHas('api_keys', ['id' => $clientKey->getKey()]);
    }

    /**
     * @param array<string, string> $overrides
     *
     * @return array<string, string>
     */
    private function permissions(array $overrides = []): array
    {
        return array_replace(
            array_fill_keys(AdminAcl::getResourceList(), 'none'),
            $overrides
        );
    }
}
