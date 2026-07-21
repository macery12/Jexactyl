<?php

namespace Everest\Http\Requests\Api\Client\Account;

use Illuminate\Validation\Rule;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class UpdateLanguageRequest extends ClientApiRequest
{
    /**
     * Admins can disable per-user language selection panel-wide
     * (app:user_locale); the endpoint 403s while the toggle is off.
     */
    public function authorize(): bool
    {
        if (!parent::authorize()) {
            return false;
        }

        return (bool) config('app.user_locale', true);
    }

    public function rules(): array
    {
        return [
            // null clears the preference so the account follows the panel default.
            'language' => ['present', 'nullable', 'string', Rule::in(config('app.locales', ['en']))],
        ];
    }
}
