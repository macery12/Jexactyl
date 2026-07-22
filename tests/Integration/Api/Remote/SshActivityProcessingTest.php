<?php

namespace Everest\Tests\Integration\Api\Remote;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Http\Response;
use Everest\Models\ActivityLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Tests\Integration\Api\Client\ClientApiIntegrationTestCase;

class SshActivityProcessingTest extends ClientApiIntegrationTestCase
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
     * Test that SSH activity events are properly stored and returned.
     */
    public function testSshActivityEventsAreStored(): void
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

        $sshEvents = [
            'server:ssh.login',
            'server:ssh.logout',
            'server:ssh.command',
            'server:ssh.power',
            'server:sftp.login',
            'server:sftp.logout',
        ];

        foreach ($sshEvents as $event) {
            $log = ActivityLog::query()->create([
                'event' => $event,
                'ip' => '192.168.1.100',
                'actor_id' => $user->id,
                'actor_type' => $user->getMorphClass(),
                'properties' => json_encode(['source' => 'ssh', 'type' => 'shell']),
                'timestamp' => now(),
            ]);

            DB::table('activity_log_subjects')->insert([
                'activity_log_id' => $log->id,
                'subject_id' => $server->id,
                'subject_type' => $server->getMorphClass(),
            ]);
        }

        $response = $this->actingAs($user)->getJson("/api/client/servers/{$server->uuid}/activity");

        $response->assertStatus(Response::HTTP_OK);
        $response->assertJsonCount(count($sshEvents), 'data');

        // Verify all events are present
        $events = collect($response->json('data'))->pluck('attributes.event')->toArray();
        foreach ($sshEvents as $event) {
            $this->assertContains($event, $events, "Event {$event} should be in activity log");
        }

        // Verify SSH events have the source metadata
        foreach ($response->json('data') as $item) {
            $properties = $item['attributes']['properties'] ?? null;
            $this->assertNotNull($properties, 'Properties should not be null');
            $this->assertEquals('ssh', $properties->source ?? $properties['source'] ?? null);
        }
    }

    /**
     * Test that SSH activity translations exist for all new events.
     */
    public function testSshActivityTranslationsExist(): void
    {
        $events = [
            'server.ssh.login',
            'server.ssh.logout',
            'server.ssh.command',
            'server.ssh.power',
            'server.sftp.login',
            'server.sftp.logout',
        ];

        foreach ($events as $event) {
            $translation = trans("activity.{$event}");
            // The translation should not be the key itself (which means it wasn't found)
            $this->assertNotEquals(
                "activity.{$event}",
                $translation,
                "Translation for activity event '{$event}' should exist"
            );
        }
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
