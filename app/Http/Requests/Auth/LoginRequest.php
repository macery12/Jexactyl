<?php

namespace Everest\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
{
    // Was spelled authorized() and therefore never invoked — FormRequest's
    // contract is authorize(). Behaviour is unchanged (both allow), but the
    // method is now actually part of the request lifecycle.
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return self::loginRules();
    }

    /**
     * Shared with LoginController, which cannot type-hint this request:
     * AuthenticatesUsers::login() fixes the parameter to Illuminate\Http\Request,
     * and PHP forbids narrowing a parameter type in an override. The controller
     * applies these rules directly instead, which keeps them defined once.
     */
    public static function loginRules(): array
    {
        return [
            'user' => 'required|string|min:1',
            'password' => 'required|string',
            'remember' => 'sometimes|boolean',
        ];
    }
}
