<?php

namespace Everest\Tests\Unit\Console\Commands\User;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Users\UserCreationService;

class MakeUserCommandTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('admin_roles');
        Schema::create('admin_roles', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('name');
            $table->boolean('is_owner')->default(false);
        });
    }

    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testFalseAdminOptionCreatesARegularUser(): void
    {
        $creation = \Mockery::mock(UserCreationService::class);
        $creation->shouldReceive('handle')
            ->once()
            ->with(\Mockery::on(
                static fn (array $data): bool => !isset($data['admin_role_id'])
                && !isset($data['root_admin'])
            ))
            ->andReturn($this->user(false));
        $this->app->instance(UserCreationService::class, $creation);

        $this->artisan('p:user:make', $this->arguments('false'))
            ->expectsOutputToContain('Owner')
            ->assertSuccessful();
    }

    public function testTrueAdminOptionAssignsTheOwnerProfile(): void
    {
        $ownerId = AdminRole::query()->insertGetId([
            'name' => 'Owner',
            'is_owner' => true,
        ]);

        $creation = \Mockery::mock(UserCreationService::class);
        $creation->shouldReceive('handle')
            ->once()
            ->with(\Mockery::on(
                static fn (array $data): bool => $data['admin_role_id'] === $ownerId
                && $data['root_admin'] === true
            ))
            ->andReturn($this->user(true, $ownerId));
        $this->app->instance(UserCreationService::class, $creation);

        $this->artisan('p:user:make', $this->arguments('true'))->assertSuccessful();
    }

    public function testInvalidAdminOptionFailsWithoutCreatingAUser(): void
    {
        $creation = \Mockery::mock(UserCreationService::class);
        $creation->shouldNotReceive('handle');
        $this->app->instance(UserCreationService::class, $creation);

        $this->artisan('p:user:make', $this->arguments('sometimes'))
            ->expectsOutputToContain('must be a boolean')
            ->assertFailed();
    }

    public function testMissingOwnerProfileFailsWithoutCreatingAUser(): void
    {
        $creation = \Mockery::mock(UserCreationService::class);
        $creation->shouldNotReceive('handle');
        $this->app->instance(UserCreationService::class, $creation);

        $this->artisan('p:user:make', $this->arguments('1'))
            ->expectsOutputToContain('Owner access profile is missing')
            ->assertFailed();
    }

    /**
     * @return array<string, string|bool>
     */
    private function arguments(string $admin): array
    {
        return [
            '--email' => 'cli@example.com',
            '--username' => 'cli-user',
            '--password' => 'Password123',
            '--admin' => $admin,
        ];
    }

    private function user(bool $owner, ?int $ownerId = null): User
    {
        $user = new User();
        $user->forceFill([
            'uuid' => '00000000-0000-0000-0000-000000000001',
            'email' => 'cli@example.com',
            'username' => 'cli-user',
            'admin_role_id' => $ownerId,
        ]);
        $user->setRelation(
            'adminRole',
            $owner ? AdminRole::query()->findOrFail($ownerId) : null
        );

        return $user;
    }
}
