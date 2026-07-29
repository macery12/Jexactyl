<?php

namespace Everest\Tests\Unit\Services\Migration;

use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Illuminate\Database\SQLiteConnection;
use Everest\Services\Migration\ImportSummary;
use Everest\Services\Migration\Profiles\JexpanelProfile;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Services\Migration\JexpanelAccessProfileImportService;

class JexpanelAccessProfileImportServiceTest extends TestCase
{
    public function testOwnerCollisionIsRemappedAndUserAssignmentsArePreserved(): void
    {
        $source = $this->connection();
        $target = $this->connection();
        $this->createSourceSchema($source);
        $this->createTargetSchema($target);

        $target->table('admin_roles')->insert([
            'id' => 1,
            'name' => 'Owner',
            'sort_id' => -1,
            'permissions' => json_encode([]),
            'is_system' => true,
            'is_owner' => true,
            'api_eligible' => false,
        ]);
        $target->table('users')->insert([
            ['id' => 10, 'admin_role_id' => null, 'root_admin' => false],
            ['id' => 11, 'admin_role_id' => null, 'root_admin' => false],
        ]);

        $source->table('admin_roles')->insert([
            [
                'id' => 1,
                'name' => 'Infrastructure',
                'sort_id' => 1,
                'permissions' => json_encode([AdminRole::NODES_READ]),
            ],
            [
                'id' => 7,
                'name' => 'Billing',
                'sort_id' => 2,
                'permissions' => json_encode(['billing.product-create']),
            ],
        ]);
        $source->table('users')->insert([
            ['id' => 10, 'admin_role_id' => 1, 'root_admin' => false],
            ['id' => 11, 'admin_role_id' => 7, 'root_admin' => false],
        ]);

        $summary = new ImportSummary();
        (new JexpanelAccessProfileImportService(new AdminCapabilityRegistry()))
            ->handle($source, $target, $summary);

        $this->assertTrue((bool) $target->table('admin_roles')->where('id', 1)->value('is_owner'));

        $infrastructure = $target->table('admin_roles')->where('name', 'Infrastructure')->first();
        $this->assertNotSame(1, (int) $infrastructure->id);
        $this->assertFalse((bool) $infrastructure->api_eligible);
        $this->assertContains(
            AdminRole::ALLOCATIONS_READ,
            json_decode($infrastructure->permissions, true)
        );
        $this->assertSame(
            (int) $infrastructure->id,
            (int) $target->table('users')->where('id', 10)->value('admin_role_id')
        );

        $billing = $target->table('admin_roles')->where('name', 'Billing')->first();
        $this->assertSame(7, (int) $billing->id);
        $this->assertContains(
            AdminRole::BILLING_PRODUCTS_CREATE,
            json_decode($billing->permissions, true)
        );
        $this->assertSame(2, $summary->copied['admin_roles']);
    }

    public function testJexpanelPlanDefersProfilesAndUserAssignmentsToCollisionSafeImporter(): void
    {
        $plans = collect((new JexpanelProfile())->tables())->keyBy->table;

        $this->assertFalse($plans->has('admin_roles'));
        $this->assertArrayHasKey('admin_role_id', $plans->get('users')->converted);
    }

    private function connection(): SQLiteConnection
    {
        return new SQLiteConnection(new \PDO('sqlite::memory:'), ':memory:');
    }

    private function createSourceSchema(SQLiteConnection $connection): void
    {
        $connection->statement(
            'CREATE TABLE admin_roles (
                id INTEGER PRIMARY KEY,
                name VARCHAR(64) NOT NULL,
                description VARCHAR(255) NULL,
                sort_id INTEGER NOT NULL,
                permissions TEXT NULL,
                color VARCHAR(64) NULL
            )'
        );
        $connection->statement(
            'CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                admin_role_id INTEGER NULL,
                root_admin INTEGER NOT NULL DEFAULT 0
            )'
        );
    }

    private function createTargetSchema(SQLiteConnection $connection): void
    {
        $connection->statement(
            'CREATE TABLE admin_roles (
                id INTEGER PRIMARY KEY,
                name VARCHAR(64) NOT NULL,
                description VARCHAR(255) NULL,
                sort_id INTEGER NOT NULL,
                permissions TEXT NULL,
                color VARCHAR(64) NULL,
                is_system INTEGER NOT NULL DEFAULT 0,
                is_owner INTEGER NOT NULL DEFAULT 0,
                api_eligible INTEGER NOT NULL DEFAULT 0
            )'
        );
        $connection->statement(
            'CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                admin_role_id INTEGER NULL,
                root_admin INTEGER NOT NULL DEFAULT 0
            )'
        );
    }
}
