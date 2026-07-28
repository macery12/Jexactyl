<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Client\Servers;

use Everest\Models\Node;
use Everest\Tests\TestCase;
use Everest\Models\Permission;

/**
 * Test that Wings-RS controller properly validates supercharged status and permissions.
 */
class WingsRsControllerTest extends TestCase
{
    /**
     * Test that isSupercharged returns true only for Wings-RS nodes.
     */
    public function testSuperchargedCheckLogic()
    {
        $nodeDefault = new Node();
        $nodeDefault->wings_type = Node::WINGS_TYPE_DEFAULT;

        $nodeRs = new Node();
        $nodeRs->wings_type = Node::WINGS_TYPE_RS;

        $this->assertFalse($nodeDefault->isSupercharged());
        $this->assertTrue($nodeRs->isSupercharged());
    }

    /**
     * Test that nodes with null wings_type are not supercharged.
     */
    public function testNullWingsTypeIsNotSupercharged()
    {
        $node = new Node();
        // Before migration runs, wings_type may be null
        $node->setRawAttributes(['wings_type' => null]);

        $this->assertFalse($node->isSupercharged());
    }

    /**
     * Test that the node default attributes set wings_type correctly.
     */
    public function testNodeDefaultAttributes()
    {
        $node = new Node();

        $this->assertEquals(Node::WINGS_TYPE_DEFAULT, $node->wings_type);
    }

    // ─── Fix 3: script.run permission ─────────────────────────────────────

    /**
     * Confirm the script.run permission constant exists on Permission model.
     */
    public function testScriptRunPermissionConstantExists()
    {
        $this->assertEquals('script.run', Permission::ACTION_SCRIPT_RUN);
    }

    /**
     * Confirm script.run is listed in the Permission::permissions() collection
     * so it appears in the subuser permission UI.
     */
    public function testScriptRunAppearsInPermissionList()
    {
        $permissions = Permission::permissions();

        $this->assertArrayHasKey('script', $permissions->toArray());
        $this->assertArrayHasKey('run', $permissions->get('script')['keys']);
    }

    /**
     * Confirm runScript does NOT use startup.update — those are different permissions.
     */
    public function testRunScriptDoesNotUseStartupUpdatePermission()
    {
        // Inspect the controller source to assert startup.update is not used for runScript.
        $source = file_get_contents(
            base_path('app/Http/Controllers/Api/Client/Servers/WingsRsController.php')
        );

        // The runScript method should reference ACTION_SCRIPT_RUN.
        $this->assertStringContainsString('ACTION_SCRIPT_RUN', $source);

        // The runScript method block should NOT gate on ACTION_STARTUP_UPDATE.
        // We check that ACTION_STARTUP_UPDATE does not appear anywhere in the file
        // (it was only ever used there, and has now been replaced).
        $this->assertStringNotContainsString('ACTION_STARTUP_UPDATE', $source);
    }

    // ─── Fix 2: upgrade endpoint hardening ────────────────────────────────

    /**
     * Confirm upgradeSystem no longer accepts restart_command or headers parameters.
     */
    public function testUpgradeSystemSignatureIsHardened()
    {
        $reflection = new \ReflectionMethod(
            \Everest\Repositories\Wings\DaemonWingsRsRepository::class,
            'upgradeSystem'
        );

        $params = array_map(fn ($p) => $p->getName(), $reflection->getParameters());

        $this->assertContains('url', $params);
        $this->assertContains('sha256', $params);
        $this->assertNotContains('restartCommand', $params);
        $this->assertNotContains('restartArgs', $params);
        $this->assertNotContains('headers', $params);
    }

    // ─── Fix 5: TLS verify ────────────────────────────────────────────────

    /**
     * Confirm DaemonRepository uses the explicit Wings TLS verification setting.
     */
    public function testDaemonRepositoryUsesConfiguredTlsVerification()
    {
        $source = file_get_contents(
            base_path('app/Repositories/Wings/DaemonRepository.php')
        );

        $this->assertStringContainsString("config('everest.wings.verify_tls')", $source);
    }

    // ─── Fix 6: operationId validation ────────────────────────────────────

    /**
     * Confirm the cancelOperation method validates the operation ID format.
     */
    public function testCancelOperationValidatesOperationId()
    {
        $source = file_get_contents(
            base_path('app/Http/Controllers/Api/Client/Servers/WingsRsController.php')
        );

        $this->assertStringContainsString('preg_match', $source);
    }

    // ─── Fix 7: searchFiles input bounds ──────────────────────────────────

    /**
     * Confirm searchFiles per_page max was reduced from 500 to 100.
     */
    public function testSearchFilesPerPageMaxIs100()
    {
        $source = file_get_contents(
            base_path('app/Http/Controllers/Api/Client/Servers/WingsRsController.php')
        );

        // Should have max:100 for per_page, not max:500.
        $this->assertStringContainsString('max:100', $source);
        $this->assertStringNotContainsString('max:500', $source);
    }

    /**
     * Confirm content_filter.query has a max length set.
     */
    public function testSearchFilesContentQueryHasMaxLength()
    {
        $source = file_get_contents(
            base_path('app/Http/Controllers/Api/Client/Servers/WingsRsController.php')
        );

        $this->assertStringContainsString('content_filter.query', $source);
        $this->assertStringContainsString('max:1024', $source);
    }

    // ─── Fix 1: RBAC FormRequests ─────────────────────────────────────────

    /**
     * Confirm the three Wings-RS application FormRequest classes exist and declare
     * the correct admin permissions.
     */
    public function testWingsRsNodeReadRequestRequiresNodesRead()
    {
        $req = new \Everest\Http\Requests\Api\Application\Nodes\WingsRsNodeReadRequest();
        $this->assertEquals(\Everest\Models\AdminRole::NODES_READ, $req->permission());
    }

    public function testWingsRsNodeUpdateRequestRequiresNodesUpdate()
    {
        $req = new \Everest\Http\Requests\Api\Application\Nodes\WingsRsNodeUpdateRequest();
        $this->assertEquals(\Everest\Models\AdminRole::NODES_UPDATE, $req->permission());
    }

    public function testWingsRsServerReadRequestRequiresServersRead()
    {
        $req = new \Everest\Http\Requests\Api\Application\Servers\WingsRsServerReadRequest();
        $this->assertEquals(\Everest\Models\AdminRole::SERVERS_READ, $req->permission());
    }
}
