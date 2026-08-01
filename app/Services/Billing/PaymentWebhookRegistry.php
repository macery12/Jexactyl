<?php

namespace Everest\Services\Billing;

final class PaymentWebhookRegistry
{
    public const STRIPE_CUSTOMER_DELETED = 'customer.deleted';
    public const STRIPE_PAYMENT_INTENT_SUCCEEDED = 'payment_intent.succeeded';

    public const STRIPE_EVENTS = [
        self::STRIPE_CUSTOMER_DELETED,
        self::STRIPE_PAYMENT_INTENT_SUCCEEDED,
    ];

    public const PAYPAL_POSITIVE_EVENTS = [
        'CHECKOUT.ORDER.COMPLETED',
        'PAYMENT.CAPTURE.COMPLETED',
    ];

    public const PAYPAL_NEGATIVE_EVENTS = [
        'PAYMENT.CAPTURE.DENIED',
        'PAYMENT.CAPTURE.REFUNDED',
        'PAYMENT.CAPTURE.REVERSED',
    ];

    public const PAYPAL_EVENTS = [
        ...self::PAYPAL_POSITIVE_EVENTS,
        ...self::PAYPAL_NEGATIVE_EVENTS,
    ];

    /**
     * Return the non-secret provider setup data shown to administrators.
     */
    public function adminConfiguration(): array
    {
        return [
            'stripe' => [
                'url' => route('webhook.stripe'),
                'events' => self::STRIPE_EVENTS,
                'signing_secret_configured' => !empty(config('services.stripe.webhook_secret')),
            ],
            'paypal' => [
                'url' => route('webhook.paypal'),
                'events' => self::PAYPAL_EVENTS,
            ],
        ];
    }
}
