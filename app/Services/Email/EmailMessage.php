<?php

namespace Everest\Services\Email;

class EmailMessage
{
    private const TAG_ALLOWED_PATTERN = '/[^A-Za-z0-9_-]/';
    private const MAX_TAG_LENGTH = 256;

    /**
     * Attachments array. Each entry:
     *   ['filename' => 'invoice.pdf', 'content' => <raw bytes>, 'content_type' => 'application/pdf']
     */
    public ?array $attachments = null;

    public function __construct(
        public string $to,
        public string $subject,
        public string $html,
        public ?string $text = null,
        public ?array $tags = null,
        public ?string $from = null,
        public ?string $fromName = null,
        public ?string $replyTo = null,
        ?array $attachments = null,
    ) {
        $this->attachments = $attachments;
    }

    /**
     * Sanitize tag values (replaces dots and special chars with underscores).
     */
    private function sanitizeTag(string $value): string
    {
        return preg_replace(self::TAG_ALLOWED_PATTERN, '_', $value);
    }

    /**
     * Convert the email message to an array for the Resend API.
     */
    public function toArray(): array
    {
        $data = [
            'to' => [$this->to],
            'subject' => $this->subject,
            'html' => $this->html,
        ];

        if ($this->text !== null) {
            $data['text'] = $this->text;
        }

        if ($this->tags !== null && count($this->tags) > 0) {
            $cleanTags = [];

            foreach ($this->tags as $tag) {
                $name = $this->sanitizeTag((string) ($tag['name'] ?? ''));
                $value = $this->sanitizeTag((string) ($tag['value'] ?? ''));

                $name = substr($name, 0, self::MAX_TAG_LENGTH);
                $value = substr($value, 0, self::MAX_TAG_LENGTH);

                if ($name !== '' && $value !== '') {
                    $cleanTags[] = ['name' => $name, 'value' => $value];
                }
            }

            if (!empty($cleanTags)) {
                $data['tags'] = $cleanTags;
            }
        }

        // From field is REQUIRED by Resend API
        // Format: "Name <email@domain.com>" or "email@domain.com"
        if ($this->from !== null && $this->from !== '') {
            $data['from'] = $this->fromName
                ? "{$this->fromName} <{$this->from}>"
                : $this->from;
        } else {
            // This should never happen if EmailManager validates correctly
            // But include a fallback to prevent API errors
            throw new \InvalidArgumentException('From email address is required but was not provided');
        }

        if ($this->replyTo !== null && $this->replyTo !== '') {
            $data['reply_to'] = $this->replyTo;
        }

        // Attachments — supported by Resend API as base64-encoded content
        if (!empty($this->attachments)) {
            $data['attachments'] = array_map(function (array $att) {
                return [
                    'filename' => $att['filename'],
                    'content' => base64_encode($att['content']),
                    'content_type' => $att['content_type'] ?? 'application/octet-stream',
                ];
            }, $this->attachments);
        }


        return $data;
    }
}
