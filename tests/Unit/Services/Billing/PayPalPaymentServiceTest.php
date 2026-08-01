<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Everest\Exceptions\Billing\BillingException;
use Everest\Services\Billing\PayPalPaymentService;
use Everest\Models\Billing\BillingException as BillingExceptionModel;

class PayPalPaymentServiceTest extends TestCase
{
    private PayPalPaymentService $service;

    /**
     * Setup test instance.
     */
    public function setUp(): void
    {
        parent::setUp();

        // Mock PayPal configuration
        config()->set('modules.billing.paypal_standalone', [
            'client_id' => 'test_client_id',
            'client_secret' => 'test_client_secret',
            'mode' => 'sandbox',
        ]);

        $this->service = new PayPalPaymentService();
    }

    /**
     * Test that PayPal service throws exception when credentials are missing.
     */
    public function testThrowsExceptionWhenCredentialsAreMissing()
    {
        config()->set('modules.billing.paypal_standalone', [
            'client_id' => null,
            'client_secret' => null,
            'mode' => 'sandbox',
        ]);

        $service = new PayPalPaymentService();
        $this->expectException(BillingException::class);
        $this->expectExceptionMessage('PayPal is not configured');

        $service->createOrder($this->payload());
    }

    /**
     * Test that authentication failure throws proper BillingException.
     */
    public function testAuthenticationFailureThrowsBillingException()
    {
        Log::spy();

        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'error' => 'invalid_client',
                'access_token' => 'should-not-appear-in-logs',
            ], 401),
        ]);

        $this->expectException(BillingException::class);
        $this->expectExceptionMessage('Failed to authenticate with PayPal');

        $service = new PayPalPaymentService();
        try {
            $service->createOrder($this->payload());
        } finally {
            Log::shouldHaveReceived('error')
                ->once()
                ->withArgs(function (string $message, array $context): bool {
                    $serialized = json_encode($context);

                    return $message === 'PayPal authentication failed'
                        && isset($context['response_summary'])
                        && !array_key_exists('response', $context)
                        && !array_key_exists('raw_body', $context)
                        && !str_contains((string) $serialized, 'should-not-appear-in-logs');
                });
        }
    }

    /**
     * Test that order creation failure throws BillingException with context.
     */
    public function testOrderCreationFailureThrowsBillingExceptionWithContext()
    {
        Log::spy();

        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'access_token' => 'test_token',
                'expires_in' => 3600,
            ], 200),
            '*/v2/checkout/orders' => Http::response([
                'error' => 'invalid_request',
                'token' => 'provider-secret',
            ], 400),
        ]);

        try {
            $service = new PayPalPaymentService();
            $service->createOrder($this->payload());
            $this->fail('Expected BillingException was not thrown');
        } catch (BillingException $e) {
            $this->assertStringContainsString('Failed to create PayPal order', $e->getMessage());
            $this->assertEquals(BillingExceptionModel::TYPE_PAYMENT, $e->getExceptionType());
            $this->assertEquals('paypal', $e->getPaymentProcessor());
            $this->assertSame('order_71', $e->getContext()['reference_id']);
            $this->assertArrayHasKey('response_summary', $e->getContext());
            $this->assertArrayNotHasKey('response', $e->getContext());
            $this->assertStringNotContainsString('provider-secret', json_encode($e->getContext()));
        }

        Log::shouldHaveReceived('error')
            ->once()
            ->withArgs(function (string $message, array $context): bool {
                $serialized = json_encode($context);

                return $message === 'PayPal order creation failed'
                    && isset($context['response_summary'])
                    && !array_key_exists('error_response', $context)
                    && !array_key_exists('raw_body', $context)
                    && !str_contains((string) $serialized, 'provider-secret');
            });
    }

    /**
     * Test that successful order creation returns order data.
     */
    public function testSuccessfulOrderCreationReturnsOrderData()
    {
        $orderId = 'ORDER123';

        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'access_token' => 'test_token',
                'expires_in' => 3600,
            ], 200),
            '*/v2/checkout/orders' => Http::response([
                'id' => $orderId,
                'status' => 'CREATED',
                'links' => [
                    ['rel' => 'approve', 'href' => 'https://paypal.com/approve'],
                ],
            ], 201),
        ]);

        $service = new PayPalPaymentService();
        $result = $service->createOrder($this->payload(), 'checkout-order-71');

        $this->assertEquals($orderId, $result['id']);
        $this->assertEquals('CREATED', $result['status']);
        Http::assertSent(function (\Illuminate\Http\Client\Request $request): bool {
            return $request->hasHeader('PayPal-Request-Id', 'checkout-order-71')
                && $request->data() === $this->payload();
        });
    }

    /**
     * Test that invalid order ID format throws validation exception.
     */
    public function testInvalidOrderIdFormatThrowsValidationException()
    {
        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'access_token' => 'test_token',
                'expires_in' => 3600,
            ], 200),
        ]);

        $service = new PayPalPaymentService();

        $this->expectException(BillingException::class);
        $this->expectExceptionMessage('Invalid PayPal order ID format');

        $service->getOrder('invalid order id with spaces');
    }

    /**
     * Test that order retrieval failure throws BillingException.
     */
    public function testOrderRetrievalFailureThrowsBillingException()
    {
        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'access_token' => 'test_token',
                'expires_in' => 3600,
            ], 200),
            '*/v2/checkout/orders/*' => Http::response(['error' => 'not_found'], 404),
        ]);

        $service = new PayPalPaymentService();

        $this->expectException(BillingException::class);
        $this->expectExceptionMessage('Failed to fetch PayPal order');

        $service->getOrder('ORDER123');
    }

    /**
     * Test that capture failure throws BillingException.
     */
    public function testCaptureFailureThrowsBillingException()
    {
        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'access_token' => 'test_token',
                'expires_in' => 3600,
            ], 200),
            '*/v2/checkout/orders/*/capture' => Http::response(['error' => 'capture_failed'], 422),
        ]);

        $service = new PayPalPaymentService();

        $this->expectException(BillingException::class);
        $this->expectExceptionMessage('Failed to capture PayPal order');

        $service->captureOrder('ORDER123');
    }

    /**
     * Test that successful capture returns capture data.
     */
    public function testSuccessfulCaptureReturnsCaptureData()
    {
        Http::fake([
            '*/v1/oauth2/token' => Http::response([
                'access_token' => 'test_token',
                'expires_in' => 3600,
            ], 200),
            '*/v2/checkout/orders/*/capture' => Http::response([
                'id' => 'ORDER123',
                'status' => 'COMPLETED',
            ], 200),
        ]);

        $service = new PayPalPaymentService();
        $result = $service->captureOrder('ORDER123');

        $this->assertEquals('ORDER123', $result['id']);
        $this->assertEquals('COMPLETED', $result['status']);
    }

    private function payload(): array
    {
        return [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => 'order_71',
                'description' => 'Test Product',
                'amount' => [
                    'currency_code' => 'USD',
                    'value' => '19.99',
                ],
                'custom_id' => '{"order_id":71}',
            ]],
            'application_context' => [
                'brand_name' => 'Test Panel',
                'landing_page' => 'BILLING',
                'user_action' => 'PAY_NOW',
                'return_url' => 'http://return',
                'cancel_url' => 'http://cancel',
            ],
        ];
    }

    /**
     * Clean up after tests.
     */
    protected function tearDown(): void
    {
        \Mockery::close();
        parent::tearDown();
    }
}
