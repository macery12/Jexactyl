<?php

namespace Everest\Rules;

use Illuminate\Contracts\Validation\Rule;

class NotTestEmailDomain implements Rule
{
    /**
     * Determine if the email does not belong to a configured test domain.
     *
     * @param string $attribute
     */
    public function passes($attribute, $value): bool
    {
        return !is_test_domain((string) $value);
    }

    /**
     * Get the validation error message.
     */
    public function message(): string
    {
        return 'Enter a valid email address.';
    }
}
