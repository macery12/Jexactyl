<?php

namespace Everest\Services\Email\Emails;

class CustomMessageEmail extends BaseEmail
{
    public function __construct(
        private string $subject,
        private string $html,
        private ?string $text = null,
        private ?array $tags = null,
    ) {
    }

    public function subject(): string
    {
        return $this->subject;
    }

    public function view(): string
    {
        // Custom emails use direct HTML, not a view
        return '';
    }

    public function data(): array
    {
        return [];
    }

    public function tags(): ?array
    {
        return $this->tags;
    }

    public function text(): ?string
    {
        return $this->text;
    }

    /**
     * Get the HTML content directly.
     */
    public function getHtml(): string
    {
        return $this->html;
    }
}
