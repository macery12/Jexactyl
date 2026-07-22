<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Services\Email\EmailRedactor;

class EmailRedactorTest extends TestCase
{
    public function testItRedactsExactKeys(): void
    {
        $payload = [
            'api_key' => 'secret',
            'smtp_password' => 'password',
            'from_email' => 'test@example.com',
        ];

        $this->assertSame([
            'api_key' => '[REDACTED]',
            'smtp_password' => '[REDACTED]',
            'from_email' => 'test@example.com',
        ], EmailRedactor::redactExactKeys($payload, ['api_key', 'smtp_password']));
    }

    public function testItRedactsNestedSensitivePayloadKeys(): void
    {
        $payload = [
            'authorization' => 'Bearer token',
            'nested' => [
                'apiKey' => 'key',
                'safe' => 'value',
            ],
        ];

        $this->assertSame([
            'authorization' => '[REDACTED]',
            'nested' => [
                'apiKey' => '[REDACTED]',
                'safe' => 'value',
            ],
        ], EmailRedactor::redactSensitivePayload($payload, ['authorization', 'apiKey']));
    }
}
