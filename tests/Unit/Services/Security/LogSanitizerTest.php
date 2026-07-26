<?php

namespace Everest\Tests\Unit\Services\Security;

use Everest\Tests\TestCase;
use Everest\Services\Security\LogSanitizer;

class LogSanitizerTest extends TestCase
{
    public function testRedactsNestedSensitivePayload(): void
    {
        $sentinel = 'M12-SECRET-SENTINEL';
        $payload = [
            'token' => $sentinel,
            'nested' => [
                'authorization' => $sentinel,
                'database_password' => $sentinel,
                'private_key' => $sentinel,
                'safe' => 'value',
            ],
            'setting' => [
                'key' => 'paypal_standalone:client_secret',
                'value' => $sentinel,
            ],
        ];

        $sanitized = LogSanitizer::redactSensitivePayload($payload);

        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['token']);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['nested']['authorization']);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['nested']['database_password']);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['nested']['private_key']);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['setting']['value']);
        $this->assertSame('value', $sanitized['nested']['safe']);
        $this->assertStringNotContainsString($sentinel, json_encode($sanitized, JSON_THROW_ON_ERROR));
    }

    public function testMasksIdentifiersWithoutExposingFullValue(): void
    {
        $masked = LogSanitizer::maskIdentifier('PAYPAL-ORDER-1234567890');

        $this->assertSame('PAYP...7890', $masked);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, LogSanitizer::maskIdentifier('short'));
    }

    public function testRedactsScheduledCommandPayloadFromSiblingAction(): void
    {
        $sanitized = LogSanitizer::redactSensitivePayload([
            'name' => 'nightly task',
            'action' => 'command',
            'payload' => 'rcon.password M12-SCHEDULE-SECRET',
        ]);

        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['payload']);
        $this->assertStringNotContainsString(
            'M12-SCHEDULE-SECRET',
            json_encode($sanitized, JSON_THROW_ON_ERROR)
        );
    }

    public function testSanitizeUrlRedactsSensitiveQueryValues(): void
    {
        $sanitized = LogSanitizer::sanitizeUrlForLogging('https://example.com/callback?token=abc123&processor=paypal');

        $this->assertSame('https://example.com/[REDACTED_PATH]?[REDACTED_QUERY]', $sanitized);
    }

    public function testRedactsContextualEnvironmentAndUrlSecrets(): void
    {
        $sentinel = 'M12-CONTEXTUAL-SECRET';
        $sanitized = LogSanitizer::redactSensitivePayload([
            'startup' => [
                'variable' => 'RCON_PASSWORD',
                'old' => $sentinel . '-old',
                'new' => $sentinel . '-new',
            ],
            'webhook_setting' => [
                'key' => 'url',
                'value' => 'https://discord.com/api/webhooks/123/' . $sentinel,
            ],
            'file_pull' => [
                'url' => 'https://downloads.example.test/private/' . $sentinel . '?signature=' . $sentinel,
            ],
        ]);

        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['startup']['old']);
        $this->assertSame(LogSanitizer::REDACTED_VALUE, $sanitized['startup']['new']);
        $this->assertSame('https://discord.com/[REDACTED_PATH]', $sanitized['webhook_setting']['value']);
        $this->assertSame(
            'https://downloads.example.test/[REDACTED_PATH]?[REDACTED_QUERY]',
            $sanitized['file_pull']['url']
        );
        $this->assertStringNotContainsString(
            $sentinel,
            json_encode($sanitized, JSON_THROW_ON_ERROR)
        );
    }

    public function testSummarizeProviderPayloadKeepsOnlySafeSummaryFields(): void
    {
        $summary = LogSanitizer::summarizeProviderPayload([
            'error' => 'invalid_client',
            'message' => 'Credentials rejected',
            'access_token' => 'secret',
            'details' => [['issue' => 'bad_request']],
        ]);

        $this->assertSame('invalid_client', $summary['error']);
        $this->assertSame('Credentials rejected', $summary['message']);
        $this->assertSame(1, $summary['detail_count']);
        $this->assertArrayNotHasKey('access_token', $summary);
    }
}
