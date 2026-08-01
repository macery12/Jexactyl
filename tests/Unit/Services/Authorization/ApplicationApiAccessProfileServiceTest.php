<?php

namespace Everest\Tests\Unit\Services\Authorization;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

class ApplicationApiAccessProfileServiceTest extends TestCase
{
    public function testKeyAuthorityComesFromBoundProfileRatherThanCreatorProfile(): void
    {
        $creatorProfile = $this->profile(1, [AdminRole::USERS_READ]);
        $keyProfile = $this->profile(2, [AdminRole::SETTINGS_UPDATE]);
        $creator = User::factory()->make(['admin_role_id' => $creatorProfile->id]);
        $creator->setRelation('adminRole', $creatorProfile);

        $key = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'admin_role_id' => $keyProfile->id,
        ]);
        $key->setRelation('accessProfile', $keyProfile);
        $creator->withAccessToken($key);

        $service = $this->service();

        $this->assertTrue($service->allows($key, AdminRole::SETTINGS_UPDATE));
        $this->assertFalse($service->allows($key, AdminRole::USERS_READ));
        $this->assertSame([AdminRole::SETTINGS_UPDATE], $service->principalCapabilities($creator));
    }

    public function testOwnerAndNonApiProfilesCannotBackAKey(): void
    {
        $owner = $this->profile(1, app(AdminCapabilityRegistry::class)->all(), true, false);
        $disabled = $this->profile(2, [AdminRole::SERVERS_READ], false, false);

        foreach ([$owner, $disabled] as $profile) {
            $key = ApiKey::factory()->make([
                'key_type' => ApiKey::TYPE_APPLICATION,
                'admin_role_id' => $profile->id,
            ]);
            $key->setRelation('accessProfile', $profile);

            $this->assertNull($this->service()->profileFor($key));
        }
    }

    public function testServiceKeyCanDelegateOnlyAnEqualOrNarrowerProfile(): void
    {
        $keyProfile = $this->profile(1, [
            AdminRole::API_CREATE,
            AdminRole::SERVERS_READ,
        ]);
        $actor = User::factory()->make();
        $key = ApiKey::factory()->make([
            'key_type' => ApiKey::TYPE_APPLICATION,
            'admin_role_id' => $keyProfile->id,
        ]);
        $key->setRelation('accessProfile', $keyProfile);
        $actor->withAccessToken($key);

        $this->assertTrue($this->service()->canDelegate(
            $actor,
            $this->profile(2, [AdminRole::SERVERS_READ])
        ));
        $this->assertFalse($this->service()->canDelegate(
            $actor,
            $this->profile(3, [AdminRole::SERVERS_UPDATE])
        ));
    }

    private function service(): ApplicationApiAccessProfileService
    {
        return new ApplicationApiAccessProfileService(new AdminCapabilityRegistry());
    }

    /**
     * @param list<string> $permissions
     */
    private function profile(
        int $id,
        array $permissions,
        bool $owner = false,
        bool $apiEligible = true,
    ): AdminRole {
        $profile = new AdminRole();
        $profile->forceFill([
            'id' => $id,
            'permissions' => $permissions,
            'is_owner' => $owner,
            'is_system' => $owner,
            'api_eligible' => $apiEligible,
        ]);

        return $profile;
    }
}
