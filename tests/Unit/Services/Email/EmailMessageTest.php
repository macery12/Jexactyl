<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Services\Email\EmailMessage;

class EmailMessageTest extends TestCase
{
    public function testTagsAreSanitizedAndFilteredInPayload(): void
    {
        $message = new EmailMessage(
            to: 'user@example.com',
            subject: 'Subject',
            html: '<p>Hello</p>',
            tags: [
                ['name' => 'template.key', 'value' => 'auth_password_reset'],
                ['name' => '', 'value' => 'value'],
                ['name' => 'name', 'value' => ''],
                ['name' => 'corr', 'value' => 'abc-123:xyz'],
            ],
            from: 'noreply@example.com'
        );

        $payload = $message->toArray();

        $this->assertSame([
            ['name' => 'template_key', 'value' => 'auth_password_reset'],
            ['name' => 'corr', 'value' => 'abc-123_xyz'],
        ], $payload['tags']);
    }
}
