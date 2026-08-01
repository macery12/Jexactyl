<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Everest\Services\Billing\PaymentWebhookRegistry;

class PaymentWebhookRegistryTest extends TestCase
{
    public function testItProvidesCanonicalProviderSetupDetails(): void
    {
        config()->set('services.stripe.webhook_secret', 'whsec_test');

        $configuration = app(PaymentWebhookRegistry::class)->adminConfiguration();

        $this->assertSame(route('webhook.stripe'), $configuration['stripe']['url']);
        $this->assertSame(
            [
                'customer.deleted',
                'payment_intent.succeeded',
            ],
            $configuration['stripe']['events']
        );
        $this->assertTrue($configuration['stripe']['signing_secret_configured']);

        $this->assertSame(route('webhook.paypal'), $configuration['paypal']['url']);
        $this->assertSame(
            [
                'CHECKOUT.ORDER.COMPLETED',
                'PAYMENT.CAPTURE.COMPLETED',
                'PAYMENT.CAPTURE.DENIED',
                'PAYMENT.CAPTURE.REFUNDED',
                'PAYMENT.CAPTURE.REVERSED',
            ],
            $configuration['paypal']['events']
        );
    }

    public function testItOnlyExposesWhetherTheStripeSigningSecretExists(): void
    {
        config()->set('services.stripe.webhook_secret', null);

        $configuration = app(PaymentWebhookRegistry::class)->adminConfiguration();

        $this->assertFalse($configuration['stripe']['signing_secret_configured']);
        $this->assertArrayNotHasKey('signing_secret', $configuration['stripe']);
    }
}
