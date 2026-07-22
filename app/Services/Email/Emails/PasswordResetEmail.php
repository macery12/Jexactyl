<?php

namespace Everest\Services\Email\Emails;

class PasswordResetEmail extends BaseEmail
{
    public function __construct(
        private string $resetUrl,
        private string $userName,
    ) {
    }

    public function subject(): string
    {
        return 'Reset Your Password';
    }

    public function view(): string
    {
        return 'emails.password-reset';
    }

    public function data(): array
    {
        return [
            'resetUrl' => $this->resetUrl,
            'userName' => $this->userName,
        ];
    }

    public function tags(): ?array
    {
        return [
            [
                'name' => 'category',
                'value' => 'password_reset',
            ],
        ];
    }
}
