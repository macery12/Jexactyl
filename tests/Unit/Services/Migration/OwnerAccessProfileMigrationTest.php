<?php

namespace Everest\Tests\Unit\Services\Migration;

use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

class OwnerAccessProfileMigrationTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('users');
        Schema::dropIfExists('admin_roles');

        Schema::create('admin_roles', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('name');
            $table->string('description')->nullable();
            $table->integer('sort_id')->default(0);
            $table->json('permissions')->nullable();
            $table->string('color')->nullable();
        });
        Schema::create('users', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('admin_role_id')->nullable();
            $table->boolean('root_admin')->default(false);
        });
    }

    public function testMigrationPreservesCustomProfilesAndMovesRootsToProtectedOwner(): void
    {
        $legacyProfileId = DB::table('admin_roles')->insertGetId([
            'name' => 'Legacy administrators',
            'sort_id' => 5,
            'permissions' => json_encode([
                'billing.product-create',
                AdminRole::NODES_READ,
                AdminRole::SERVERS_UPDATE,
            ]),
        ]);
        $rootId = DB::table('users')->insertGetId([
            'admin_role_id' => $legacyProfileId,
            'root_admin' => true,
        ]);
        $delegatedId = DB::table('users')->insertGetId([
            'admin_role_id' => $legacyProfileId,
            'root_admin' => false,
        ]);

        $migration = require database_path('migrations/2026_07_29_000003_create_owner_access_profile.php');
        $migration->up();

        $owner = DB::table('admin_roles')->where('is_owner', true)->first();
        $this->assertNotNull($owner);
        $this->assertTrue((bool) $owner->is_system);
        $this->assertFalse((bool) $owner->api_eligible);
        $this->assertSame((int) $owner->id, (int) DB::table('users')->where('id', $rootId)->value('admin_role_id'));
        $this->assertSame($legacyProfileId, (int) DB::table('users')->where('id', $delegatedId)->value('admin_role_id'));
        $this->assertFalse((bool) DB::table('admin_roles')->where('id', $legacyProfileId)->value('api_eligible'));

        $permissions = json_decode(
            DB::table('admin_roles')->where('id', $legacyProfileId)->value('permissions'),
            true
        );
        $this->assertContains(AdminRole::BILLING_PRODUCTS_CREATE, $permissions);
        $this->assertContains(AdminRole::ALLOCATIONS_READ, $permissions);
        $this->assertContains(AdminRole::SERVER_DATABASES_DELETE, $permissions);

        $migration->down();
        $this->assertTrue((bool) DB::table('users')->where('id', $rootId)->value('root_admin'));
        $this->assertNull(DB::table('users')->where('id', $rootId)->value('admin_role_id'));
        $this->assertFalse(Schema::hasColumn('admin_roles', 'is_owner'));
    }
}
