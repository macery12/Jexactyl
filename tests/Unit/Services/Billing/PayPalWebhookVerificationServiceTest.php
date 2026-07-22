<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\PayPalWebhookVerificationService;

class PayPalWebhookVerificationServiceTest extends TestCase
{
    protected function tearDown(): void
    {
        Cache::flush();
        \Mockery::close();

        parent::tearDown();
    }

    public function testRejectsWebhookWhenRequiredHeadersAreMissing(): void
    {
        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldNotReceive('verifyWebhookSignature');

        $service = new PayPalWebhookVerificationService($paypalService);

        $request = Request::create('/api/webhooks/paypal', 'POST', [
            'event_type' => 'PAYMENT.CAPTURE.COMPLETED',
        ]);

        $result = $service->validate($request);

        $this->assertFalse($result['valid']);
        $this->assertSame(400, $result['status']);
        $this->assertSame('missing_signature_headers', $result['reason']);
    }

    public function testRejectsWebhookWhenTimestampIsStale(): void
    {
        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldNotReceive('verifyWebhookSignature');

        $service = new PayPalWebhookVerificationService($paypalService);

        $request = Request::create('/api/webhooks/paypal', 'POST', [], [], [], [
            'HTTP_PAYPAL_AUTH_ALGO' => 'SHA256withRSA',
            'HTTP_PAYPAL_CERT_URL' => 'https://api-m.paypal.com/v1/notifications/certs/CERT-123',
            'HTTP_PAYPAL_TRANSMISSION_ID' => 'abc123456789',
            'HTTP_PAYPAL_TRANSMISSION_SIG' => 'signature',
            'HTTP_PAYPAL_TRANSMISSION_TIME' => now()->subMinutes(15)->toIso8601String(),
            'CONTENT_TYPE' => 'application/json',
        ], json_encode(['event_type' => 'PAYMENT.CAPTURE.COMPLETED']));

        $result = $service->validate($request);

        $this->assertFalse($result['valid']);
        $this->assertSame(400, $result['status']);
        $this->assertSame('invalid_timestamp', $result['reason']);
    }

    public function testRejectsWebhookWhenSignatureIsInvalid(): void
    {
        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldReceive('verifyWebhookSignature')->once()->andReturnFalse();

        $service = new PayPalWebhookVerificationService($paypalService);

        $request = Request::create('/api/webhooks/paypal', 'POST', [], [], [], [
            'HTTP_PAYPAL_AUTH_ALGO' => 'SHA256withRSA',
            'HTTP_PAYPAL_CERT_URL' => 'https://api-m.paypal.com/v1/notifications/certs/CERT-123',
            'HTTP_PAYPAL_TRANSMISSION_ID' => 'abc123456789',
            'HTTP_PAYPAL_TRANSMISSION_SIG' => 'signature',
            'HTTP_PAYPAL_TRANSMISSION_TIME' => now()->toIso8601String(),
            'CONTENT_TYPE' => 'application/json',
        ], json_encode(['event_type' => 'PAYMENT.CAPTURE.COMPLETED']));

        $result = $service->validate($request);

        $this->assertFalse($result['valid']);
        $this->assertSame(401, $result['status']);
        $this->assertSame('invalid_signature', $result['reason']);
    }

    public function testRejectsReplayOfVerifiedWebhookTransmission(): void
    {
        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldReceive('verifyWebhookSignature')->twice()->andReturnTrue();

        $service = new PayPalWebhookVerificationService($paypalService);

        $request = Request::create('/api/webhooks/paypal', 'POST', [], [], [], [
            'HTTP_PAYPAL_AUTH_ALGO' => 'SHA256withRSA',
            'HTTP_PAYPAL_CERT_URL' => 'https://api-m.paypal.com/v1/notifications/certs/CERT-123',
            'HTTP_PAYPAL_TRANSMISSION_ID' => 'abc123456789',
            'HTTP_PAYPAL_TRANSMISSION_SIG' => 'signature',
            'HTTP_PAYPAL_TRANSMISSION_TIME' => now()->toIso8601String(),
            'CONTENT_TYPE' => 'application/json',
        ], json_encode(['event_type' => 'PAYMENT.CAPTURE.COMPLETED']));

        $first = $service->validate($request);
        $second = $service->validate($request);

        $this->assertTrue($first['valid']);
        $this->assertFalse($second['valid']);
        $this->assertSame(409, $second['status']);
        $this->assertSame('replayed_webhook', $second['reason']);
    }
}
