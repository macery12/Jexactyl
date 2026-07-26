<?php

namespace Everest\Tests\Unit\Services\Users;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Session;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Auth\UserSessionService;
use Everest\Services\Users\UserSuspensionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Everest\Exceptions\Http\Auth\AccountSuspendedException;

class UserSuspensionServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function setUp(): void
    {
        parent::setUp();

        $this->createTables();
    }

    public function testSuspensionRevokesAllSessionsAndEveryApiKeyTypeWithoutClearingRole(): void
    {
        [$user, $roleId] = $this->createUser();

        DB::table('api_keys')->insert([
            $this->apiKey($user->id, ApiKey::TYPE_ACCOUNT, 'account-key-0001'),
            $this->apiKey($user->id, ApiKey::TYPE_APPLICATION, 'app-key-0000001'),
        ]);
        DB::table('user_sessions')->insert([
            $this->sessionRow($user->id, 'active-session', null),
            $this->sessionRow($user->id, 'old-session', now()->subDay()),
        ]);

        $sessions = \Mockery::mock(UserSessionService::class);
        $sessions->shouldReceive('revokeAll')
            ->once()
            ->with(\Mockery::on(fn (User $revokedUser) => $revokedUser->id === $user->id));

        $suspended = (new UserSuspensionService($sessions))->suspend($user);

        $this->assertTrue($suspended->isSuspended());
        $this->assertSame($roleId, $suspended->admin_role_id);
        $this->assertSame(0, DB::table('api_keys')->where('user_id', $user->id)->count());
        $this->assertSame(
            0,
            DB::table('user_sessions')
                ->where('user_id', $user->id)
                ->whereNull('revoked_at')
                ->count()
        );
    }

    public function testUnsuspensionDoesNotRestoreDeletedKeysOrRevokeSessionsAgain(): void
    {
        [$user] = $this->createUser();

        DB::table('api_keys')->insert($this->apiKey(
            $user->id,
            ApiKey::TYPE_APPLICATION,
            'app-key-0000002'
        ));

        $sessions = \Mockery::mock(UserSessionService::class);
        $sessions->shouldReceive('revokeAll')->once();
        $service = new UserSuspensionService($sessions);

        $service->suspend($user);
        $active = $service->unsuspend($user);

        $this->assertTrue($active->isActive());
        $this->assertSame(0, DB::table('api_keys')->where('user_id', $user->id)->count());
    }

    public function testRootAdministratorCannotBeSuspended(): void
    {
        [$user] = $this->createUser(root: true);

        $sessions = \Mockery::mock(UserSessionService::class);
        $sessions->shouldNotReceive('revokeAll');

        $this->expectException(DisplayException::class);

        (new UserSuspensionService($sessions))->suspend($user);
    }

    public function testSuspendedAccountCannotIssueAnAccountApiKey(): void
    {
        [$user] = $this->createUser();
        $user->forceFill(['state' => 'suspended'])->saveOrFail();

        $this->expectException(DisplayException::class);

        $user->createToken('blocked', []);
    }

    public function testSuspendedAccountCannotRecordANewLoginSession(): void
    {
        [$user] = $this->createUser();
        $user->forceFill(['state' => 'suspended'])->saveOrFail();
        $deviceId = null;

        $this->expectException(AccountSuspendedException::class);

        (new UserSessionService(Request::create('/', 'POST')))
            ->recordLogin($user, 'late-session', $deviceId);
    }

    public function testRevokeAllIsDatabaseFirstWhenBackingSessionDestroyFails(): void
    {
        [$user] = $this->createUser();
        DB::table('user_sessions')->insert([
            $this->sessionRow($user->id, 'first-session', null),
            $this->sessionRow($user->id, 'second-session', null),
        ]);

        $handler = \Mockery::mock(\SessionHandlerInterface::class);
        $handler->shouldReceive('destroy')
            ->twice()
            ->andThrow(new \RuntimeException('session backend unavailable'));
        Session::shouldReceive('getHandler')->twice()->andReturn($handler);

        (new UserSessionService(Request::create('/', 'POST')))->revokeAll($user);

        $this->assertSame(
            0,
            DB::table('user_sessions')
                ->where('user_id', $user->id)
                ->whereNull('revoked_at')
                ->count()
        );
    }

    /**
     * @return array{User, int}
     */
    private function createUser(bool $root = false): array
    {
        $suffix = bin2hex(random_bytes(4));
        $roleId = DB::table('admin_roles')->insertGetId([
            'name' => 'role-' . $suffix,
            'sort_id' => 0,
            'permissions' => '[]',
        ]);

        $userId = DB::table('users')->insertGetId([
            'uuid' => '00000000-0000-4000-8000-' . str_pad((string) random_int(1, 999999999999), 12, '0', STR_PAD_LEFT),
            'username' => 'user-' . $suffix,
            'email' => $suffix . '@example.test',
            'password' => 'unused',
            'root_admin' => $root,
            'use_totp' => false,
            'admin_role_id' => $roleId,
            'state' => null,
            'language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [User::query()->findOrFail($userId), $roleId];
    }

    private function apiKey(int $userId, int $type, string $identifier): array
    {
        return [
            'user_id' => $userId,
            'key_type' => $type,
            'identifier' => str_pad($identifier, 16, '0'),
            'token' => 'encrypted-token',
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    private function sessionRow(int $userId, string $sessionId, mixed $revokedAt): array
    {
        return [
            'user_id' => $userId,
            'session_id' => $sessionId,
            'revoked_at' => $revokedAt,
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    private function createTables(): void
    {
        if (!Schema::hasTable('admin_roles')) {
            Schema::create('admin_roles', function (Blueprint $table) {
                $table->increments('id');
                $table->string('name');
                $table->string('description')->nullable();
                $table->integer('sort_id')->default(0);
                $table->json('permissions')->nullable();
                $table->string('color')->nullable();
            });
        }

        if (!Schema::hasTable('users')) {
            Schema::create('users', function (Blueprint $table) {
                $table->increments('id');
                $table->uuid('uuid')->unique();
                $table->string('username')->unique();
                $table->string('email')->unique();
                $table->text('password')->nullable();
                $table->boolean('root_admin')->default(false);
                $table->boolean('use_totp')->default(false);
                $table->unsignedInteger('admin_role_id')->nullable();
                $table->string('state')->nullable();
                $table->string('language')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('api_keys')) {
            Schema::create('api_keys', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('user_id');
                $table->unsignedTinyInteger('key_type')->default(0);
                $table->char('identifier', 16)->nullable();
                $table->text('token');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('user_sessions')) {
            Schema::create('user_sessions', function (Blueprint $table) {
                $table->bigIncrements('id');
                $table->unsignedInteger('user_id');
                $table->string('session_id');
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
            });
        }
    }
}
