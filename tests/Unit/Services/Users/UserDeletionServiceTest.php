<?php

namespace Everest\Tests\Unit\Services\Users;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Users\UserDeletionService;
use Illuminate\Contracts\Translation\Translator;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Everest\Contracts\Repository\UserRepositoryInterface;

class UserDeletionServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function setUp(): void
    {
        parent::setUp();

        $this->createTables();
    }

    public function testDelegatedAdministratorCannotDeleteRootUsingStaleRouteModel(): void
    {
        $target = $this->createUser(root: true);
        $actor = $this->createUser(root: false);

        // Simulate stale/tampered route-model state. The service must re-read
        // root_admin under its transaction lock.
        $target->root_admin = false;

        $repository = \Mockery::mock(UserRepositoryInterface::class);
        $repository->shouldNotReceive('delete');

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('Only an active root administrator');

        $this->service($repository)->handle($target, $actor);
    }

    public function testRootCanDeleteAnotherRootWhenAnActiveRootRemains(): void
    {
        $target = $this->createUser(root: true);
        $actor = $this->createUser(root: true);

        $repository = \Mockery::mock(UserRepositoryInterface::class);
        $repository->shouldReceive('delete')->once()->with($target->id)->andReturn(1);

        $this->service($repository)->handle($target, $actor);
    }

    public function testAdministratorCannotDeleteSelf(): void
    {
        $actor = $this->createUser(root: true);

        $repository = \Mockery::mock(UserRepositoryInterface::class);
        $repository->shouldNotReceive('delete');

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('own account');

        $this->service($repository)->handle($actor, $actor);
    }

    public function testTrustedConsolePathCannotDeleteFinalActiveRoot(): void
    {
        $target = $this->createUser(root: true);

        $repository = \Mockery::mock(UserRepositoryInterface::class);
        $repository->shouldNotReceive('delete');

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('final active root');

        $this->service($repository)->handle($target);
    }

    public function testServerOwnershipIsRecheckedBeforeDelete(): void
    {
        $target = $this->createUser(root: false);
        $actor = $this->createUser(root: true);
        DB::table('servers')->insert([
            'owner_id' => $target->id,
        ]);

        $repository = \Mockery::mock(UserRepositoryInterface::class);
        $repository->shouldNotReceive('delete');

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('translated-server-error');

        $this->service($repository, true)->handle($target, $actor);
    }

    private function service(
        UserRepositoryInterface $repository,
        bool $expectTranslation = false,
    ): UserDeletionService {
        $translator = \Mockery::mock(Translator::class);
        if ($expectTranslation) {
            $translator->shouldReceive('get')
                ->once()
                ->with('admin/user.exceptions.user_has_servers')
                ->andReturn('translated-server-error');
        }

        return new UserDeletionService($repository, $translator);
    }

    private function createUser(bool $root): User
    {
        $suffix = bin2hex(random_bytes(4));
        $id = DB::table('users')->insertGetId([
            'uuid' => '00000000-0000-4000-8000-' . str_pad((string) random_int(1, 999999999999), 12, '0', STR_PAD_LEFT),
            'username' => 'delete-' . $suffix,
            'email' => 'delete-' . $suffix . '@example.test',
            'password' => 'unused',
            'root_admin' => $root,
            'use_totp' => false,
            'state' => null,
            'language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return User::query()->findOrFail($id);
    }

    private function createTables(): void
    {
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

        if (!Schema::hasTable('servers')) {
            Schema::create('servers', function (Blueprint $table) {
                $table->increments('id');
                $table->unsignedInteger('owner_id');
            });
        }
    }
}
