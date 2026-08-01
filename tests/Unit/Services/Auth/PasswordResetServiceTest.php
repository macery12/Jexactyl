<?php

namespace Everest\Tests\Unit\Services\Auth;

use Everest\Models\User;
use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Auth\PasswordResetService;

class PasswordResetServiceTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('users')) {
            Schema::create('users', function (Blueprint $table): void {
                $table->increments('id');
                $table->uuid('uuid')->unique();
                $table->string('username')->unique();
                $table->string('email')->unique();
                $table->text('password');
                $table->string('remember_token')->nullable();
                $table->boolean('root_admin')->default(false);
                $table->boolean('use_totp')->default(false);
                $table->unsignedInteger('admin_role_id')->nullable();
                $table->string('state')->nullable();
                $table->string('language')->nullable();
                $table->timestamps();
            });
        } elseif (!Schema::hasColumn('users', 'remember_token')) {
            Schema::table('users', function (Blueprint $table): void {
                $table->string('remember_token')->nullable();
            });
        }

        if (!Schema::hasTable('password_reset_tokens')) {
            Schema::create('password_reset_tokens', function (Blueprint $table): void {
                $table->string('email')->primary();
                $table->string('token');
                $table->timestamp('created_at')->nullable();
            });
        }
    }

    public function testCredentialRevocationFailureRollsBackPasswordAndTokenConsumption(): void
    {
        $suffix = bin2hex(random_bytes(5));
        $email = $suffix . '@example.test';
        $rawToken = 'reset-token-' . $suffix;
        $oldPassword = 'OldPassword!123';
        $newPassword = 'NewPassword!456';

        $userId = DB::table('users')->insertGetId([
            'uuid' => '00000000-0000-4000-8000-' . str_pad((string) random_int(1, 999999999999), 12, '0', STR_PAD_LEFT),
            'username' => 'reset-' . $suffix,
            'email' => $email,
            'password' => Hash::make($oldPassword),
            'root_admin' => false,
            'use_totp' => false,
            'state' => null,
            'language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('password_reset_tokens')->insert([
            'email' => $email,
            'token' => hash('sha256', $rawToken),
            'created_at' => now(),
        ]);

        Event::forget(PasswordReset::class);
        Event::listen(PasswordReset::class, static function (): void {
            throw new \RuntimeException('credential revocation failed');
        });

        try {
            (new PasswordResetService())->resetPassword($email, $rawToken, $newPassword);
            $this->fail('The reset must fail when credential revocation fails.');
        } catch (\RuntimeException $exception) {
            $this->assertSame('credential revocation failed', $exception->getMessage());
        }

        $user = User::query()->findOrFail($userId);
        $this->assertTrue(Hash::check($oldPassword, $user->password));
        $this->assertFalse(Hash::check($newPassword, $user->password));
        $this->assertTrue(DB::table('password_reset_tokens')->where('email', $email)->exists());
    }
}
