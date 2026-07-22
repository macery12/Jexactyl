<?php

namespace Everest\Services\Email\Emails;

class AdminBroadcastEmail extends BaseEmail
{
    public function __construct(
        private string $subject,
        private string $message,
        private ?string $adminName = null,
    ) {
    }

    public function subject(): string
    {
        return $this->subject;
    }

    public function view(): string
    {
        return 'emails.admin-broadcast';
    }

    public function data(): array
    {
        return [
            'message' => $this->message,
            'adminName' => $this->adminName ?? 'Administrator',
        ];
    }

    public function tags(): ?array
    {
        return [
            [
                'name' => 'category',
                'value' => 'admin_broadcast',
            ],
        ];
    }
}
