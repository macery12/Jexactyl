<?php

namespace Everest\Http\Requests\Auth;

use Everest\Rules\NotTestEmailDomain;
use Illuminate\Validation\Rules\Password;
use Illuminate\Foundation\Http\FormRequest;

class RegisterRequest extends FormRequest
{
    public function authorized(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => [
                'required',
                'email',
                'max:255',
                'unique:users,email',
                new NotTestEmailDomain(),
            ],
            'username' => 'required|string|min:3|max:255|alpha_dash|unique:users,username',
            'password' => [
                'required',
                'string',
                'confirmed',
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
            'username.alpha_dash' => 'Username may only contain letters, numbers, dashes, and underscores.',
            'username.min' => 'Username must be at least 3 characters long.',
            'username.unique' => 'This username is already taken.',
            'email.unique' => 'This email is already registered.',
            'email.email' => 'Enter a valid email address.',
        ];
    }
}
