<?php

namespace Everest\Tests\Unit\Http\Controllers\Webhooks;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Services\Billing\BillingValidationService;
use Everest\Services\Billing\ServerFulfillmentService;
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

        $validationService = \Mockery::mock(BillingValidationService::class);
        $validationService->shouldNotReceive('validateBillingEnabled');

        $fulfillmentService = \Mockery::mock(ServerFulfillmentService::class);
        $fulfillmentService->shouldNotReceive('fulfillOrder');

        $controller = new PayPalWebhookController(
            $paypalService,
            $verificationService,
            $validationService,
            $fulfillmentService
        );

        $response = $controller->handle(Request::create('/api/webhooks/paypal', 'POST', [
            'event_type' => 'PAYMENT.CAPTURE.COMPLETED',
        ]));

        $this->assertSame(401, $response->getStatusCode());
    }
}
