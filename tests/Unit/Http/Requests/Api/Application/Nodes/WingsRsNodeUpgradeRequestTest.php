<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Nodes;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
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

    public function testActiveRootAdministratorCanUpgradeDaemonExecutable(): void
    {
        $request = new WingsRsNodeUpgradeRequest();
        $user = new User(['state' => null]);
        $user->root_admin = true;
        $request->setUserResolver(fn () => $user);

        $this->assertTrue($request->authorize());
    }

    public function testDelegatedNodeEditorCannotUpgradeDaemonExecutable(): void
    {
        $request = new WingsRsNodeUpgradeRequest();
        $user = new User(['state' => null]);
        $user->root_admin = false;
        $user->admin_role_id = 123;
        $request->setUserResolver(fn () => $user);

        $this->assertFalse($request->authorize());
    }

    public function testSuspendedRootAdministratorCannotUpgradeDaemonExecutable(): void
    {
        $request = new WingsRsNodeUpgradeRequest();
        $user = new User(['state' => 'suspended']);
        $user->root_admin = true;
        $request->setUserResolver(fn () => $user);

        $this->assertFalse($request->authorize());
    }
}
