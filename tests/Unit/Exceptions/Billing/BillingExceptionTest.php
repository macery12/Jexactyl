<?php

namespace Everest\Tests\Unit\Exceptions\Billing;

use Everest\Tests\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Exceptions\Billing\BillingException;
use Everest\Models\Billing\BillingException as BillingExceptionModel;

class BillingExceptionTest extends TestCase
{
    /**
     * Test that BillingException can be created with minimal parameters.
     */
    public function testExceptionCanBeCreatedWithMinimalParameters()
    {
        $exception = new BillingException(
            'Test Exception',
            'This is a test error message'
        );

        $this->assertEquals('This is a test error message', $exception->getMessage());
        $this->assertEquals(BillingExceptionModel::TYPE_PAYMENT, $exception->getExceptionType());
        $this->assertNull($exception->getOrderId());
        $this->assertNull($exception->getPaymentProcessor());
        $this->assertNull($exception->getExternalId());
        $this->assertEmpty($exception->getContext());
    }

    /**
     * Test that BillingException can be created with full parameters.
     */
    public function testExceptionCanBeCreatedWithFullParameters()
    {
        $context = ['product_id' => 123, 'amount' => 19.99];

        $exception = new BillingException(
            'Payment Failed',
            'Payment could not be processed',
            BillingExceptionModel::TYPE_PAYMENT,
            456,
            'stripe',
            'pi_test123',
            $context
        );

        $this->assertEquals('Payment could not be processed', $exception->getMessage());
        $this->assertEquals(BillingExceptionModel::TYPE_PAYMENT, $exception->getExceptionType());
        $this->assertEquals(456, $exception->getOrderId());
        $this->assertEquals('stripe', $exception->getPaymentProcessor());
        $this->assertEquals('pi_test123', $exception->getExternalId());
        $this->assertEquals($context, $exception->getContext());
    }

    /**
     * Test different exception types.
     **/
    #[DataProvider('exceptionTypeProvider')]
    public function testDifferentExceptionTypes(string $type)
    {
        $exception = new BillingException(
            'Test',
            'Test message',
            $type
        );

        $this->assertEquals($type, $exception->getExceptionType());
    }

    /**
     * Test exception types data provider.
     */
    public static function exceptionTypeProvider(): array
    {
        return [
            'payment' => [BillingExceptionModel::TYPE_PAYMENT],
            'deployment' => [BillingExceptionModel::TYPE_DEPLOYMENT],
            'storefront' => [BillingExceptionModel::TYPE_STOREFRONT],
            'webhook' => [BillingExceptionModel::TYPE_WEBHOOK],
            'refund' => [BillingExceptionModel::TYPE_REFUND],
            'validation' => [BillingExceptionModel::TYPE_VALIDATION],
        ];
    }

    /**
     * Test payment processor identifiers.
     **/
    #[DataProvider('paymentProcessorProvider')]
    public function testPaymentProcessorIdentifiers(string $processor)
    {
        $exception = new BillingException(
            'Test',
            'Test message',
            BillingExceptionModel::TYPE_PAYMENT,
            null,
            $processor
        );

        $this->assertEquals($processor, $exception->getPaymentProcessor());
    }

    /**
     * Payment processor data provider.
     */
    public static function paymentProcessorProvider(): array
    {
        return [
            'stripe' => ['stripe'],
            'paypal' => ['paypal'],
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
