<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application;

use Everest\Tests\TestCase;
use Illuminate\Http\JsonResponse;
use Everest\Services\Email\EmailResult;
use Everest\Services\Email\EmailManager;
use Everest\Services\Email\EmailPolicyService;
use Everest\Services\Email\EmailSettingsReader;
use Everest\Services\Email\EmailVerificationGate;
use Everest\Http\Controllers\Api\Application\EmailController;

class EmailControllerTest extends TestCase
{
    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testFormatEmailResultIncludesTransportAliasAndConnectionTestType(): void
    {
        $response = $this->invokeControllerMethod(
            'formatEmailResult',
            EmailResult::success('msg-123'),
            'smtp',
            'connection_test'
        );

        $payload = $response->getData(true);

        $this->assertTrue($payload['success']);
        $this->assertSame('smtp', $payload['transport']);
        $this->assertSame('smtp', $payload['provider']);
        $this->assertSame('connection', $payload['test_type']);
        $this->assertArrayHasKey('tested_at', $payload);
        $this->assertArrayNotHasKey('sent_at', $payload);
    }

    public function testFormatEmailResultIncludesRecipientForDeliveryTests(): void
    {
        $response = $this->invokeControllerMethod(
            'formatEmailResult',
            EmailResult::success('msg-456'),
            'resend',
            'send_test',
            'admin@example.com'
        );

        $payload = $response->getData(true);

        $this->assertSame('resend', $payload['transport']);
        $this->assertSame('resend', $payload['provider']);
        $this->assertSame('delivery', $payload['test_type']);
        $this->assertSame('admin@example.com', $payload['recipient']);
        $this->assertArrayHasKey('tested_at', $payload);
    }

    public function testFormatExceptionErrorPreservesTestMetadata(): void
    {
        $response = $this->invokeControllerMethod(
            'formatExceptionError',
            new \RuntimeException('Boom'),
            'smtp',
            'send_test',
            'ops@example.com'
        );

        $payload = $response->getData(true);

        $this->assertFalse($payload['success']);
        $this->assertSame('smtp', $payload['transport']);
        $this->assertSame('smtp', $payload['provider']);
        $this->assertSame('delivery', $payload['test_type']);
        $this->assertSame('ops@example.com', $payload['recipient']);
        $this->assertSame('SMTP_UNEXPECTED_ERROR', $payload['error']['code']);
        $this->assertArrayHasKey('tested_at', $payload);
    }

    private function invokeControllerMethod(string $method, mixed ...$arguments): JsonResponse
    {
        $controller = new EmailController(
            \Mockery::mock(EmailManager::class),
            \Mockery::mock(EmailVerificationGate::class),
            \Mockery::mock(EmailSettingsReader::class),
            \Mockery::mock(EmailPolicyService::class)
        );

        $reflection = new \ReflectionMethod($controller, $method);
        $reflection->setAccessible(true);

        /** @var JsonResponse $response */
        $response = $reflection->invokeArgs($controller, $arguments);

        return $response;
    }
}
