<?php

namespace Everest\Http\Requests\Auth;

use Illuminate\Validation\Rules\Password;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Final step of an SSO signup: the provider identity is already verified and
 * held in the session, so only the panel-side details are collected here.
 *
 * A password is still required — SFTP, database users and the recovery flow all
 * need one, and an account that can only ever be reached through the provider is
 * unrecoverable if the module is later switched off.
 */
class CompleteSsoRegistrationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'username' => 'required|string|min:3|max:255|alpha_dash|unique:users,username',
            'password' => [
                'required',
                'string',
                'same:confirm_password',
                Password::min(12)
                    ->mixedCase()
                    ->numbers()
                    ->symbols()
                    ->uncompromised(),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'password.min' => 'Password must be at least 12 characters long.',
            'password.mixed' => 'Password must contain both uppercase and lowercase letters.',
            'password.numbers' => 'Password must contain at least one number.',
            'password.symbols' => 'Password must contain at least one special character.',
            'password.uncompromised' => 'This password has been compromised in a data breach. Please choose a different password.',
            'password.same' => 'The password confirmation does not match.',
            'username.alpha_dash' => 'Username may only contain letters, numbers, dashes, and underscores.',
            'username.min' => 'Username must be at least 3 characters long.',
            'username.unique' => 'This username is already taken.',
        ];
    }
}
