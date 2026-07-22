<?php

namespace Everest\Services\Email\Emails;

class AccountCreatedEmail extends BaseEmail
{
    public function __construct(
        private string $userName,
        private string $email,
        private string $loginUrl,
    ) {
    }

    public function subject(): string
    {
        return 'Welcome! Your Account Has Been Created';
    }

    public function view(): string
    {
        return 'emails.account-created';
    }

    public function data(): array
    {
        return [
            'userName' => $this->userName,
            'email' => $this->email,
            'loginUrl' => $this->loginUrl,
        ];
    }

    public function tags(): ?array
    {
        return [
            [
                'name' => 'category',
                'value' => 'account_created',
            ],
        ];
    }
}
