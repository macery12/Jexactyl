<?php

namespace Everest\Tests\Unit\Services\Authorization;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Laravel\Sanctum\TransientToken;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\Authorization\AdminCapabilityRegistry;

class AdminAuthorizerTest extends TestCase
{
    public function testOwnerAuthorityComesFromProfileNotLegacyFlag(): void
    {
        $legacyOnly = $this->userWithProfile(null);
        $legacyOnly->setRawAttributes(array_merge($legacyOnly->getAttributes(), ['root_admin' => 1]));

        $owner = $this->userWithProfile($this->profile([
            'is_owner' => true,
            'api_eligible' => false,
            'permissions' => [],
        ]));

        $this->assertFalse($this->authorizer()->isOwner($legacyOnly));
        $this->assertTrue($this->authorizer()->isOwner($owner));
        $this->assertSame(['*'], $this->authorizer()->capabilities($owner));
    }

    public function testCustomProfileIsRestrictedToItsCanonicalCapabilities(): void
    {
        $user = $this->userWithProfile($this->profile([
            'is_owner' => false,
            'api_eligible' => true,
            'permissions' => ['billing.product-create', 'billing.not-real'],
        ]));

        $this->assertTrue($this->authorizer()->hasCapability($user, AdminRole::BILLING_PRODUCTS_CREATE));
        $this->assertFalse($this->authorizer()->hasCapability($user, AdminRole::USERS_UPDATE));
        $this->assertNotContains('billing.not-real', $this->authorizer()->capabilities($user));
    }

    public function testOwnerOnlyHumanAuthorityRejectsApiKeys(): void
    {
        $owner = $this->userWithProfile($this->profile(['is_owner' => true]));
        $owner->withAccessToken(new TransientToken());
        $this->assertTrue($this->authorizer()->isInteractiveOwner($owner));

        $owner->withAccessToken(new ApiKey(['key_type' => ApiKey::TYPE_APPLICATION]));
        $this->assertFalse($this->authorizer()->isInteractiveOwner($owner));
    }

    private function authorizer(): AdminAuthorizer
    {
        return new AdminAuthorizer(new AdminCapabilityRegistry());
    }

    private function userWithProfile(?AdminRole $profile): User
    {
        $user = User::factory()->make([
            'state' => null,
            'admin_role_id' => $profile?->id,
        ]);
        $user->setRelation('adminRole', $profile);

        return $user;
    }

    private function profile(array $attributes): AdminRole
    {
        $profile = new AdminRole();
        $profile->forceFill($attributes);

        return $profile;
    }
}
