<?php

namespace Everest\Tests\Unit\Services\Migration;

use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Services\Api\LegacyApplicationKeyProfileMigrationService;

class ReconcileAccessProfilePermissionsMigrationTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('admin_roles');
        Schema::create('admin_roles', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('name');
            $table->string('description')->nullable();
            $table->json('permissions')->nullable();
            $table->boolean('is_system')->default(false);
            $table->boolean('is_owner')->default(false);
            $table->boolean('api_eligible')->default(false);
        });
    }

    public function testMigrationCanonicalizesProfilesAndRepairsOwnerFlags(): void
    {
        $ownerId = DB::table('admin_roles')->insertGetId([
            'name' => 'Owner',
            'permissions' => json_encode([]),
            'is_system' => false,
            'is_owner' => true,
            'api_eligible' => true,
        ]);
        $customId = DB::table('admin_roles')->insertGetId([
            'name' => 'Custom',
            'permissions' => json_encode([
                'billing.product-create',
                'marketplace.read',
                'marketplace.update',
                'marketplace.install',
                'repositories.read',
                'repositories.create',
                'extensions.create',
                AdminRole::MOUNTS_READ,
                AdminRole::USERS_READ,
                'removed.permission',
            ]),
            'is_system' => false,
            'is_owner' => false,
            'api_eligible' => true,
        ]);

        $this->migration()->up();

        $owner = DB::table('admin_roles')->find($ownerId);
        $this->assertTrue((bool) $owner->is_system);
        $this->assertFalse((bool) $owner->api_eligible);
        $this->assertEqualsCanonicalizing(
            app(AdminCapabilityRegistry::class)->all(),
            json_decode($owner->permissions, true, flags: JSON_THROW_ON_ERROR)
        );

        $custom = DB::table('admin_roles')->find($customId);
        $this->assertTrue((bool) $custom->api_eligible);
        $this->assertSame(
            [
                AdminRole::BILLING_PRODUCTS_CREATE,
                AdminRole::MODS_READ,
                AdminRole::MODS_UPDATE,
                AdminRole::EXTENSIONS_READ,
                AdminRole::EXTENSIONS_REPOSITORIES,
                AdminRole::EXTENSIONS_INSTALL,
                AdminRole::USERS_READ,
            ],
            json_decode($custom->permissions, true, flags: JSON_THROW_ON_ERROR)
        );
    }

    public function testMigrationRejectsMissingOrDuplicateOwnerProfiles(): void
    {
        $migration = $this->migration();

        try {
            $migration->up();
            $this->fail('A missing Owner profile should stop the migration.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('found 0', $exception->getMessage());
        }

        DB::table('admin_roles')->insert([
            [
                'name' => 'Owner one',
                'permissions' => '[]',
                'is_owner' => true,
            ],
            [
                'name' => 'Owner two',
                'permissions' => '[]',
                'is_owner' => true,
            ],
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('found 2');
        $migration->up();
    }

    public function testMigrationRejectsMalformedPermissionDataWithoutChangingProfiles(): void
    {
        $ownerId = DB::table('admin_roles')->insertGetId([
            'name' => 'Owner',
            'permissions' => json_encode([]),
            'is_owner' => true,
        ]);
        $customId = DB::table('admin_roles')->insertGetId([
            'name' => 'Corrupt',
            'permissions' => '{"users.read":true}',
        ]);

        try {
            $this->migration()->up();
            $this->fail('Malformed profile permissions should stop reconciliation.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('must be a JSON list of strings', $exception->getMessage());
        }

        $this->assertSame([], json_decode(
            DB::table('admin_roles')->where('id', $ownerId)->value('permissions'),
            true,
            flags: JSON_THROW_ON_ERROR
        ));
        $this->assertSame(
            '{"users.read":true}',
            DB::table('admin_roles')->where('id', $customId)->value('permissions')
        );
    }

    public function testMigrationDoesNotReexpandAnAlreadyMaskedKeyProfile(): void
    {
        DB::table('admin_roles')->insert([
            'name' => 'Owner',
            'permissions' => json_encode([]),
            'is_owner' => true,
        ]);
        $profileId = DB::table('admin_roles')->insertGetId([
            'name' => 'Migrated key ptla_test',
            'description' => LegacyApplicationKeyProfileMigrationService::GENERATED_DESCRIPTION,
            'permissions' => json_encode([AdminRole::DATABASES_READ]),
            'api_eligible' => true,
        ]);

        $this->migration()->up();

        $permissions = json_decode(
            DB::table('admin_roles')->where('id', $profileId)->value('permissions'),
            true,
            flags: JSON_THROW_ON_ERROR
        );
        $this->assertSame([AdminRole::DATABASES_READ], $permissions);
        $this->assertNotContains(AdminRole::SERVER_DATABASES_READ, $permissions);
    }

    private function migration(): object
    {
        return require database_path('migrations/2026_07_30_000001_reconcile_access_profile_permissions.php');
    }
}
