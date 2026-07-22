<?php

namespace Everest\Tests\Integration\Api\Client\Server;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Http\Response;
use Everest\Models\ActivityLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

class ActivityLogControllerTest extends ClientApiIntegrationTestCase
{
    public function setUp(): void
    {
        parent::setUp();

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', ':memory:');

        app('db')->purge();
        app('db')->setDefaultConnection('sqlite');
        app('db')->reconnect();
        $this->setUpDatabase();
    }

    /**
     * Ensure server activity endpoint includes all server scoped logs (including admin actions).
     */
    public function testServerActivityIncludesAdminLogs(): void
    {
        $user = User::factory()->create();

        DB::table('nodes')->insert([
            'id' => 1,
            'name' => 'Node',
            'maintenance_mode' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('nests')->insert([
            'id' => 1,
            'name' => 'Default Nest',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('eggs')->insert([
            'id' => 1,
            'nest_id' => 1,
            'name' => 'Default Egg',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('allocations')->insert([
            'id' => 1,
            'node_id' => 1,
            'server_id' => null,
            'ip' => '127.0.0.1',
            'port' => 25565,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $server = Server::withoutEvents(function () use ($user) {
            $model = new Server([
                'uuid' => \Ramsey\Uuid\Uuid::uuid4()->toString(),
                'uuidShort' => 'shortuuid',
                'name' => 'Test Server',
                'owner_id' => $user->id,
                'node_id' => 1,
                'allocation_id' => 1,
                'egg_id' => 1,
                'nest_id' => 1,
                'memory' => 512,
                'swap' => 0,
                'io' => 500,
                'cpu' => 50,
                'disk' => 1024,
                'startup' => '/bin/bash',
                'image' => 'alpine:latest',
                'status' => null,
                'installed_at' => now(),
                'database_limit' => 0,
                'backup_limit' => 0,
            ]);

            $model->skipValidation()->save();

            return $model;
        });

        $userLog = ActivityLog::query()->create([
            'event' => 'server:task',
            'ip' => '127.0.0.1',
            'actor_id' => $user->id,
            'actor_type' => $user->getMorphClass(),
            'server_id' => $server->id,
            'is_admin' => false,
            'scope' => 'server',
            'timestamp' => now(),
        ]);

        $adminLog = ActivityLog::query()->create([
            'event' => 'admin:event',
            'ip' => '127.0.0.1',
            'actor_id' => $user->id,
            'actor_type' => $user->getMorphClass(),
            'server_id' => $server->id,
            'is_admin' => true,
            'scope' => 'server',
            'timestamp' => now(),
        ]);

        $server->activity()->attach($userLog->id);
        $server->activity()->attach($adminLog->id);

        $response = $this->actingAs($user)->getJson("/api/client/servers/{$server->uuid}/activity");

        $response->assertStatus(Response::HTTP_OK);
        $response->assertJsonCount(2, 'data');
        $response->assertJsonFragment(['event' => 'admin:event']);
        $response->assertJsonFragment(['event' => 'server:task']);
        $response->assertJsonFragment(['scope' => 'server']);
    }

    protected function setUpDatabase(): void
    {
        Schema::connection('sqlite')->dropAllTables();

        Schema::create('users', function (Blueprint $table) {
            $table->increments('id');
            $table->integer('external_id')->nullable();
            $table->uuid('uuid')->nullable();
            $table->string('username');
            $table->string('email')->nullable();
            $table->string('password')->nullable();
            $table->string('language')->default('en');
            $table->boolean('use_totp')->default(false);
            $table->string('totp_secret')->nullable();
            $table->timestamp('totp_authenticated_at')->nullable();
            $table->unsignedInteger('admin_role_id')->nullable();
            $table->boolean('gravatar')->default(false);
            $table->string('state')->nullable();
            $table->string('recovery_code')->nullable();
            $table->rememberToken();
            $table->timestamp('email_verified_at')->nullable();
            $table->boolean('root_admin')->default(false);
            $table->timestamps();
        });

        Schema::create('activity_logs', function (Blueprint $table) {
            $table->increments('id');
            $table->string('batch')->nullable();
            $table->string('event');
            $table->string('ip');
            $table->text('description')->nullable();
            $table->string('actor_type')->nullable();
            $table->unsignedInteger('actor_id')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('api_key_id')->nullable();
            $table->boolean('is_admin')->default(false);
            $table->string('scope')->nullable();
            $table->json('properties')->nullable();
            $table->timestamp('timestamp')->useCurrent();
        });

        Schema::create('servers', function (Blueprint $table) {
            $table->increments('id');
            $table->uuid('uuid');
            $table->string('uuidShort')->nullable();
            $table->string('name')->nullable();
            $table->unsignedInteger('owner_id')->nullable();
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('allocation_id')->nullable();
            $table->unsignedInteger('egg_id')->nullable();
            $table->unsignedInteger('nest_id')->nullable();
            $table->unsignedInteger('group_id')->nullable();
            $table->string('external_id')->nullable();
            $table->integer('memory')->default(0);
            $table->integer('swap')->default(0);
            $table->integer('disk')->default(0);
            $table->integer('io')->default(0);
            $table->integer('cpu')->default(0);
            $table->string('threads')->nullable();
            $table->boolean('skip_scripts')->default(false);
            $table->boolean('oom_killer')->default(false);
            $table->string('status')->nullable();
            $table->timestamp('installed_at')->nullable();
            $table->integer('allocation_limit')->nullable();
            $table->integer('database_limit')->nullable();
            $table->integer('backup_limit')->default(0);
            $table->string('startup')->nullable();
            $table->string('image')->nullable();
            $table->timestamps();
        });

        Schema::create('allocations', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('node_id')->nullable();
            $table->unsignedInteger('server_id')->nullable();
            $table->string('ip')->nullable();
            $table->unsignedInteger('port')->nullable();
            $table->timestamps();
        });

        Schema::create('nests', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name')->nullable();
            $table->timestamps();
        });

        Schema::create('eggs', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('nest_id')->nullable();
            $table->string('name')->nullable();
            $table->timestamps();
        });

        Schema::create('activity_log_subjects', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('activity_log_id');
            $table->unsignedInteger('subject_id');
            $table->string('subject_type');
        });

        Schema::create('settings', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->text('value')->nullable();
        });

        Schema::create('server_transfers', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id')->nullable();
            $table->boolean('successful')->nullable();
            $table->timestamps();
        });

        Schema::create('nodes', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name')->nullable();
            $table->boolean('maintenance_mode')->default(false);
            $table->timestamps();
        });

        Schema::create('database_hosts', function (Blueprint $table) {
            $table->increments('id');
            $table->string('name')->nullable();
            $table->timestamps();
        });

        Schema::create('databases', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id')->nullable();
            $table->unsignedInteger('database_host_id')->nullable();
            $table->string('database')->nullable();
            $table->string('username')->nullable();
            $table->string('password')->nullable();
            $table->string('remote')->nullable();
            $table->integer('max_connections')->nullable();
            $table->timestamps();
        });

        Schema::create('backups', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('server_id')->nullable();
            $table->string('uuid')->nullable();
            $table->timestamps();
        });
    }
}
