<?php

namespace Everest\Tests\Integration\Api\Application\Api;

use Everest\Models\ApiKey;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\DB;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;
use Everest\Tests\Integration\Api\Application\ApplicationApiIntegrationTestCase;

class ApiKeyControllerTest extends ApplicationApiIntegrationTestCase
{
    public function testCreatesAndDisplaysProfileBoundApplicationKey(): void
    {
        $profile = $this->profile('Provisioning', [
            AdminRole::SERVERS_READ,
            AdminRole::SERVERS_CREATE,
        ]);

        $response = $this->postJson('/api/application/api', [
            'memo' => 'Provisioning integration',
            'access_profile_id' => $profile->id,
            'allowed_ips' => ['127.0.0.1', '2001:db8::/48'],
            'expires_at' => now()->addDay()->toIso8601String(),
        ]);

        $response->assertOk()->assertJsonStructure(['token']);
        $this->assertDatabaseHas('api_keys', [
            'memo' => 'Provisioning integration',
            'key_type' => ApiKey::TYPE_APPLICATION,
            'admin_role_id' => $profile->id,
            'r_servers' => AdminAcl::NONE,
        ]);

        $this->getJson('/api/application/api')
            ->assertOk()
            ->assertJsonFragment([
                'access_profile_id' => $profile->id,
                'legacy' => false,
            ])
            ->assertJsonFragment([
                'name' => 'Provisioning',
                'api_eligible' => true,
                'is_owner' => false,
            ])
            ->assertJsonFragment([
                'username' => $this->getApiUser()->username,
                'email' => $this->getApiUser()->email,
            ]);
    }

    public function testProfileAndLegacyScopesAreMutuallyExclusive(): void
    {
        $profile = $this->profile('Read nodes', [AdminRole::NODES_READ]);

        $this->postJson('/api/application/api', [
            'memo' => 'Ambiguous authority',
            'access_profile_id' => $profile->id,
            'permissions' => $this->permissions([AdminAcl::RESOURCE_NODES => 'read']),
        ])->assertUnprocessable()
            ->assertJsonPath('errors.0.meta.source_field', 'permissions');
    }

    public function testProfileBoundKeyUsesProfileNotCreatorAuthority(): void
    {
        $profile = $this->profile('Node observer', [AdminRole::NODES_READ]);
        $this->createNewDefaultApiKey($this->getApiUser(), [
            'admin_role_id' => $profile->id,
        ]);

        $this->getJson('/api/application/nodes')->assertOk();

        $changedCreatorProfile = $this->profile('Creator changed later', [AdminRole::NODES_UPDATE]);
        $this->getApiUser()->update(['admin_role_id' => $changedCreatorProfile->id]);

        $this->getJson('/api/application/nodes')->assertOk();
        $this->postJson('/api/application/nodes', [])->assertForbidden();
    }

    public function testOwnerProfileCannotBeAssignedToKey(): void
    {
        $owner = AdminRole::query()->where('is_owner', true)->firstOrFail();

        $this->postJson('/api/application/api', [
            'memo' => 'Forbidden owner key',
            'access_profile_id' => $owner->id,
        ])->assertForbidden();
    }

    public function testServiceKeyCannotDelegateBroaderProfile(): void
    {
        $delegator = $this->profile('Key delegator', [
            AdminRole::API_CREATE,
            AdminRole::NODES_READ,
        ]);
        $broader = $this->profile('Node manager', [
            AdminRole::API_CREATE,
            AdminRole::NODES_READ,
            AdminRole::NODES_UPDATE,
        ]);
        $this->createNewDefaultApiKey($this->getApiUser(), [
            'admin_role_id' => $delegator->id,
        ]);

        $this->postJson('/api/application/api', [
            'memo' => 'Broader delegated key',
            'access_profile_id' => $broader->id,
        ])->assertForbidden();
    }

    public function testDelegableProfilesEndpointFiltersOwnerAndBroaderProfiles(): void
    {
        $delegator = $this->profile('API creator', [AdminRole::API_CREATE, AdminRole::NODES_READ]);
        $allowed = $this->profile('Allowed observer', [AdminRole::NODES_READ]);
        $broader = $this->profile('Broader manager', [AdminRole::NODES_READ, AdminRole::NODES_UPDATE]);
        $this->createNewDefaultApiKey($this->getApiUser(), [
            'admin_role_id' => $delegator->id,
        ]);

        $response = $this->getJson('/api/application/api/access-profiles')->assertOk();
        $response->assertJsonFragment(['id' => $allowed->id, 'name' => 'Allowed observer']);
        $response->assertJsonMissing(['id' => $broader->id, 'name' => 'Broader manager']);
        $response->assertJsonMissing(['is_owner' => true]);
    }

    public function testHistoricalPermissionContractCreatesNarrowGeneratedProfile(): void
    {
        $this->postJson('/api/application/api', [
            'memo' => 'Historical contract key',
            'permissions' => $this->permissions([AdminAcl::RESOURCE_NODES => 'write']),
        ])->assertOk();

        $key = ApiKey::query()->where('memo', 'Historical contract key')->firstOrFail();
        $profile = $key->accessProfile()->firstOrFail();

        $this->assertFalse($profile->is_system);
        $this->assertTrue($profile->api_eligible);
        $this->assertContains(AdminRole::NODES_READ, $profile->permissions);
        $this->assertContains(AdminRole::NODES_UPDATE, $profile->permissions);
        $this->assertNotContains(AdminRole::SETTINGS_READ, $profile->permissions);
    }

    public function testLegacyMigrationPreservesNestedScopeWithoutBroadeningNodeAuthority(): void
    {
        $key = ApiKey::factory()->create([
            'user_id' => $this->getApiUser()->id,
            'key_type' => ApiKey::TYPE_APPLICATION,
            'admin_role_id' => null,
            'acl_enforced' => true,
            'r_nodes' => AdminAcl::NONE,
            'r_allocations' => AdminAcl::READ | AdminAcl::WRITE,
        ]);

        app(LegacyApplicationKeyProfileMigrationService::class)->handle(DB::connection());
        $profile = $key->refresh()->accessProfile()->firstOrFail();

        $this->assertFalse($profile->is_system);
        $this->assertTrue($profile->api_eligible);
        $this->assertContains(AdminRole::ALLOCATIONS_READ, $profile->permissions);
        $this->assertContains(AdminRole::ALLOCATIONS_CREATE, $profile->permissions);
        $this->assertContains(AdminRole::ALLOCATIONS_DELETE, $profile->permissions);
        $this->assertNotContains(AdminRole::NODES_READ, $profile->permissions);
        $this->assertNotContains(AdminRole::NODES_UPDATE, $profile->permissions);
        // Settings was role-only in the historical ACL and is retained, but
        // never above the creator's authority.
        $this->assertContains(AdminRole::SETTINGS_READ, $profile->permissions);
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
     * @param list<string> $permissions
     */
    private function profile(string $name, array $permissions): AdminRole
    {
        return AdminRole::query()->forceCreate([
            'name' => $name,
            'description' => 'Test access profile.',
            'sort_id' => 10,
            'permissions' => $permissions,
            'color' => null,
            'is_system' => false,
            'is_owner' => false,
            'api_eligible' => true,
        ]);
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
