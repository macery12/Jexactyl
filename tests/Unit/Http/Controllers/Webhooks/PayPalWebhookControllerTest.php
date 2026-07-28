<?php

namespace Everest\Tests\Unit\Http\Controllers\Webhooks;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Services\Billing\PayPalCaptureService;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\CheckoutIntegrityService;
use Everest\Services\Billing\ServerFulfillmentService;
use Everest\Services\Billing\PayPalWebhookEventService;
use Everest\Services\Billing\PayPalNegativeEventService;
use Everest\Http\Controllers\Webhooks\PayPalWebhookController;
use Everest\Services\Billing\PayPalWebhookVerificationService;

class PayPalWebhookControllerTest extends TestCase
{
    protected function tearDown(): void
    {
        \Mockery::close();

        parent::tearDown();
    }

    public function testRejectsInvalidWebhookBeforeProviderLookup(): void
    {
        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldNotReceive('getOrder');

        $verificationService = \Mockery::mock(PayPalWebhookVerificationService::class);
        $verificationService->shouldReceive('validate')->once()->andReturn([
            'valid' => false,
            'status' => 401,
            'reason' => 'invalid_signature',
            'context' => [],
        ]);

        $fulfillmentService = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillmentService->shouldNotReceive('fulfillPayPalOrder');

        $integrityService = \Mockery::mock(CheckoutIntegrityService::class);
        $integrityService->shouldNotReceive('assertPayPalOrder');

        $captureService = \Mockery::mock(PayPalCaptureService::class);
        $captureService->shouldNotReceive('record');

        $eventService = \Mockery::mock(PayPalWebhookEventService::class);
        $eventService->shouldNotReceive('begin');

        $negativeEventService = \Mockery::mock(PayPalNegativeEventService::class);
        $negativeEventService->shouldNotReceive('record');

        $controller = new PayPalWebhookController(
            $paypalService,
            $verificationService,
            $fulfillmentService,
            $integrityService,
            $captureService,
            $eventService,
            $negativeEventService,
        );

        $response = $controller->handle(Request::create('/api/webhooks/paypal', 'POST', [
            'event_type' => 'PAYMENT.CAPTURE.COMPLETED',
        ]));

        $this->assertSame(401, $response->getStatusCode());
    }

    public function testCorrelatesVerifiedEventBeforeReturningConcurrentRetry(): void
    {
        $payload = [
            'id' => 'WH-1',
            'event_type' => 'PAYMENT.CAPTURE.COMPLETED',
            'resource' => [
                'supplementary_data' => [
                    'related_ids' => ['order_id' => 'PAYPAL-ORDER-1'],
                ],
            ],
        ];
        $request = Request::create(
            '/api/webhooks/paypal',
            'POST',
            [],
            [],
            [],
            ['CONTENT_TYPE' => 'application/json'],
            json_encode($payload, JSON_THROW_ON_ERROR),
        );

        $paypalService = \Mockery::mock(PayPalPaymentService::class);
        $paypalService->shouldNotReceive('getOrder');
        $verificationService = \Mockery::mock(PayPalWebhookVerificationService::class);
        $verificationService->shouldReceive('validate')->once()->andReturn([
            'valid' => true,
            'transmission_id' => 'TRANS-1',
        ]);
        $fulfillmentService = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillmentService->shouldNotReceive('fulfillPayPalOrder');
        $integrityService = \Mockery::mock(CheckoutIntegrityService::class);
        $integrityService->shouldNotReceive('assertPayPalOrder');
        $captureService = \Mockery::mock(PayPalCaptureService::class);
        $captureService->shouldNotReceive('record');
        $eventService = \Mockery::mock(PayPalWebhookEventService::class);
        $eventService->shouldReceive('begin')
            ->once()
            ->with('TRANS-1', $payload, 'PAYPAL-ORDER-1')
            ->andReturn(PayPalWebhookEventService::RESULT_RETRY);
        $negativeEventService = \Mockery::mock(PayPalNegativeEventService::class);
        $negativeEventService->shouldNotReceive('record');

        $controller = new PayPalWebhookController(
            $paypalService,
            $verificationService,
            $fulfillmentService,
            $integrityService,
            $captureService,
            $eventService,
            $negativeEventService,
        );

        $response = $controller->handle($request);

        $this->assertSame(503, $response->getStatusCode());
    }
}
