<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Nodes;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Laravel\Sanctum\TransientToken;
use Everest\Http\Requests\Api\Application\Nodes\WingsRsNodeUpgradeRequest;

class WingsRsNodeUpgradeRequestTest extends TestCase
{
    public function testRequestRetainsExplicitPermissionInventoryDeclaration(): void
    {
        $this->assertSame(
            AdminRole::NODES_UPDATE,
            (new WingsRsNodeUpgradeRequest())->permission()
        );
    }

    public function testActiveOwnerCanUpgradeDaemonExecutable(): void
    {
        $request = new WingsRsNodeUpgradeRequest();
        $user = $this->userWithProfile(owner: true);
        $request->setUserResolver(fn () => $user);

        $this->assertTrue($request->authorize());
    }

    public function testDelegatedNodeEditorCannotUpgradeDaemonExecutable(): void
    {
        $request = new WingsRsNodeUpgradeRequest();
        $user = $this->userWithProfile(owner: false);
        $request->setUserResolver(fn () => $user);

        $this->assertFalse($request->authorize());
    }

    public function testSuspendedOwnerCannotUpgradeDaemonExecutable(): void
    {
        $request = new WingsRsNodeUpgradeRequest();
        $user = $this->userWithProfile(owner: true, state: 'suspended');
        $request->setUserResolver(fn () => $user);

        $this->assertFalse($request->authorize());
    }

    private function userWithProfile(bool $owner, ?string $state = null): User
    {
        $profile = new AdminRole();
        $profile->forceFill([
            'id' => $owner ? 1 : 123,
            'is_system' => $owner,
            'is_owner' => $owner,
            'api_eligible' => !$owner,
            'permissions' => [AdminRole::NODES_UPDATE],
        ]);

        $user = new User(['state' => $state]);
        $user->admin_role_id = $profile->id;
        $user->setRelation('adminRole', $profile);
        $user->withAccessToken(new TransientToken());

        return $user;
    }
}
