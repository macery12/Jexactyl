<?php

namespace Everest\Services\Auth;

use Carbon\Carbon;
use Everest\Models\User;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Auth\Events\PasswordReset;
use Everest\Events\Email\PasswordResetRequested;

class PasswordResetService
{
    public function sendResetLink(string $email): bool
    {
        $user = User::where('email', $email)->first();

        if (!$user) {
            return true;
        }

        $token = Str::random(64);

        DB::table('password_reset_tokens')->updateOrInsert(
            ['email' => $email],
            ['token' => hash('sha256', $token), 'created_at' => now()]
        );

        event(new PasswordResetRequested(
            user: $user,
            resetUrl: rtrim(config('app.url'), '/') . '/auth/password/reset/' . $token . '?email=' . urlencode($email),
            correlationId: Str::uuid()->toString()
        ));

        return true;
    }

    public function validateToken(string $email, string $token): bool
    {
        $record = DB::table('password_reset_tokens')->where('email', $email)->first();

        if (!$record || !$record->created_at) {
            return false;
        }

        if (Carbon::parse($record->created_at)->addHour()->isPast()) {
            DB::table('password_reset_tokens')->where('email', $email)->delete();

            return false;
        }

        return hash_equals($record->token, hash('sha256', $token));
    }

    public function resetPassword(string $email, string $token, string $password): bool
    {
        if (!$this->validateToken($email, $token)) {
            return false;
        }

        $user = User::where('email', $email)->first();

        if (!$user) {
            DB::table('password_reset_tokens')->where('email', $email)->delete();

            return false;
        }

        $user->password = Hash::make($password);
        $user->setRememberToken(Str::random(60));
        $user->save();

        event(new PasswordReset($user));

        DB::table('password_reset_tokens')->where('email', $email)->delete();

        return true;
    }
}
