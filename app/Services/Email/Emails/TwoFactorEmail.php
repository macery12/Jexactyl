<?php

namespace Everest\Services\Email\Emails;

class TwoFactorEmail extends BaseEmail
{
    public function __construct(
        private string $userName,
        private string $code,
    ) {
    }

    public function subject(): string
    {
        return 'Your Two-Factor Authentication Code';
    }

    public function view(): string
    {
        return 'emails.two-factor';
    }

    public function data(): array
    {
        return [
            'userName' => $this->userName,
            'code' => $this->code,
        ];
    }

    public function tags(): ?array
    {
        return [
            [
                'name' => 'category',
                'value' => 'two_factor',
            ],
        ];
    }
}
