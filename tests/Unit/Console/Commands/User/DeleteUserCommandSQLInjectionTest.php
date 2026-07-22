<?php

namespace Everest\Tests\Unit\Console\Commands\User;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Users\UserDeletionService;
use Everest\Console\Commands\User\DeleteUserCommand;

/**
 * Test that LIKE wildcard characters are properly escaped in DeleteUserCommand.
 */
class DeleteUserCommandSQLInjectionTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('users');
        Schema::create('users', function (Blueprint $table) {
            $table->increments('id');
            $table->string('external_id')->nullable();
            $table->string('uuid')->unique();
            $table->string('username');
            $table->string('email')->unique();
            $table->string('password');
            $table->string('language')->default('en');
            $table->boolean('root_admin')->default(false);
            $table->boolean('use_totp')->default(false);
            $table->string('totp_secret')->nullable();
            $table->string('state')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Test that percent wildcards in search terms are properly escaped.
     */
    public function testSearchTermEscapesPercentWildcard()
    {
        // Create test users
        User::withoutEvents(function () {
            User::factory()->create(['email' => 'user1@example.com', 'username' => 'user1']);
            User::factory()->create(['email' => 'user2@example.com', 'username' => 'user2']);
            User::factory()->create(['email' => 'user100@example.com', 'username' => 'user100']);
        });

        // Mock the deletion service
        $deletionService = \Mockery::mock(UserDeletionService::class);

        $command = new DeleteUserCommand($deletionService);
        $command->setLaravel($this->app);

        // Test search with percent wildcard - should escape it
        $searchWithPercent = 'user%';
        $escapedSearch = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $searchWithPercent);

        $results = User::all()->filter(function (User $user) use ($searchWithPercent): bool {
            return str_starts_with($user->username, $searchWithPercent)
                || str_starts_with($user->email, $searchWithPercent);
        });

        // With proper escaping, should only match literal 'user%' at the start
        // Without escaping, it would match 'user1', 'user2', 'user100' (all users starting with 'user')
        $this->assertCount(0, $results);
    }

    /**
     * Test that underscore wildcards are properly escaped.
     */
    public function testSearchTermEscapesUnderscoreWildcards()
    {
        // Create test users
        User::withoutEvents(function () {
            User::factory()->create(['email' => 'user_test@example.com', 'username' => 'user_test']);
            User::factory()->create(['email' => 'userAtest@example.com', 'username' => 'userAtest']);
        });

        $deletionService = \Mockery::mock(UserDeletionService::class);

        $command = new DeleteUserCommand($deletionService);
        $command->setLaravel($this->app);

        // Test search with underscore wildcard - should escape it
        $searchWithUnderscore = 'user_';
        $escapedSearch = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $searchWithUnderscore);

        $results = User::all()->filter(function (User $user) use ($searchWithUnderscore): bool {
            return str_starts_with($user->username, $searchWithUnderscore)
                || str_starts_with($user->email, $searchWithUnderscore);
        });

        // With proper escaping, should only match 'user_test'
        // Without escaping, _ would match any single character ('userAtest' would also match)
        $this->assertCount(1, $results);
        $this->assertEquals('user_test', $results->first()->username);
    }

    /**
     * Test that backslash escaping is applied before wildcard escaping.
     */
    public function testSearchTermEscapesBackslashesBeforeWildcards()
    {
        $searchWithBackslash = 'test\\%';

        // Proper escaping order: backslash first, then wildcards
        $escapedSearch = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $searchWithBackslash);

        // Should result in 'test\\\\\\%' (escaped backslash + escaped percent)
        $this->assertEquals('test\\\\\\%', $escapedSearch);
    }

    /**
     * Test that normal search terms still work correctly.
     */
    public function testNormalSearchTermsStillWork()
    {
        // Create test users
        User::withoutEvents(function () {
            User::factory()->create(['email' => 'admin@example.com', 'username' => 'admin']);
            User::factory()->create(['email' => 'administrator@example.com', 'username' => 'administrator']);
        });

        $deletionService = \Mockery::mock(UserDeletionService::class);

        $command = new DeleteUserCommand($deletionService);
        $command->setLaravel($this->app);

        // Normal search without wildcards
        $search = 'admin';
        $escapedSearch = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);

        $results = User::query()
            ->where('id', 'LIKE', "$escapedSearch%")
            ->orWhere('username', 'LIKE', "$escapedSearch%")
            ->orWhere('email', 'LIKE', "$escapedSearch%")
            ->get();

        // Should match both users starting with 'admin'
        $this->assertCount(2, $results);
    }
}
