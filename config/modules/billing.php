<?php

return [
    /*
     * Enable or disable the billing module.
     */
    'enabled' => env('BILLING_ENABLED', true),

    /*
     * Dedicated key for encrypting invoice snapshots and storage credentials.
     * Falls back to APP_KEY when unset (see InvoiceEncryptionService).
     */
    'invoice_encryption_key' => env('INVOICE_ENCRYPTION_KEY'),

    /*
     * Configure the publishable & secret API key for Stripe.
     */
    'keys' => [
        'publishable' => env('BILLING_PUBLISHABLE_KEY', ''),
        'secret' => env('BILLING_SECRET_KEY', ''),
    ],

    /*
     * Choose whether to add PayPal integration to the Panel (via Stripe).
     * This is for PayPal integration through Stripe's payment methods.
     */
    'paypal' => env('BILLING_PAYPAL', false),

    /*
     * Configure standalone PayPal integration.
     */
    'paypal_standalone' => [
        'client_id'     => env('PAYPAL_CLIENT_ID', ''),
        'client_secret' => env('PAYPAL_CLIENT_SECRET', ''),
        'mode'          => env('PAYPAL_MODE', 'sandbox'), // 'sandbox' or 'live'
        'webhook_id'    => env('PAYPAL_WEBHOOK_ID', ''),
    ],

    /*
     * Choose whether to add Link integration to the Panel.
     */
    'link' => env('BILLING_LINK', false),

    /*
     * Set a currency code and symbol to use for billing.
     */
    'currency' => [
        'symbol' => '$',
        'code' => 'usd',
    ],

    /*
     * Configure URLs for legal documentation.
     */
    'links' => [
        'terms' => '',
        'privacy' => '',
    ],

    /*
     * Configure renewal and suspension settings.
     * NOTE: The billing cycle system uses a capped percentage-based model.
     * Grace period is 20% of billing cycle, with minimum 3 days and maximum 7 days.
     *
     * Examples:
     * - 7-day cycle: 7 × 20% = 1.4 → 3 days (minimum applied)
     * - 30-day cycle: 30 × 20% = 6 days
     * - 90-day cycle: 90 × 20% = 18 → 7 days (maximum applied)
     * - 180-day cycle: 180 × 20% = 36 → 7 days (maximum applied)
     */
    'renewal' => [
        // Default renewal period for paid servers (in days)
        'days' => env('BILLING_RENEWAL_DAYS', 30),

        // Default renewal period for free servers (in days)
        'free_renewal_days' => env('BILLING_FREE_RENEWAL_DAYS', 30),

        // Suspension threshold as percentage of billing cycle (0.20 = 20%)
        'suspension_threshold_percentage' => env('BILLING_SUSPENSION_THRESHOLD_PCT', 0.20),

        // Minimum suspension threshold in days (floor)
        'min_suspension_threshold_days' => env('BILLING_MIN_SUSPENSION_DAYS', 3),

        // Maximum suspension threshold in days (cap at 7 days for all cycles)
        'max_suspension_threshold_days' => env('BILLING_MAX_SUSPENSION_DAYS', 7),

        // Legacy suspension threshold for backward compatibility
        'suspension_threshold' => env('BILLING_SUSPENSION_THRESHOLD', 7),

        // Free products get shorter grace period
        'free_suspension_days' => env('BILLING_FREE_SUSPENSION_DAYS', 7),

        // Paid products suspension based on billing cycle
        'paid_suspension_days' => env('BILLING_PAID_SUSPENSION_DAYS', 30),

        'default_billing_days' => env('BILLING_DEFAULT_BILLING_DAYS', 30),
        'multiplier_steps' => env('BILLING_MULTIPLIER_STEPS', json_encode([
            ['maxDays' => 10, 'multiplier' => 1.30],
            ['maxDays' => 20, 'multiplier' => 1.20],
            ['maxDays' => 29, 'multiplier' => 1.10],
            ['maxDays' => 30, 'multiplier' => 1.00],
            ['maxDays' => 59, 'multiplier' => 0.95],
            ['maxDays' => 89, 'multiplier' => 0.90],
            ['maxDays' => 999, 'multiplier' => 0.85],
        ])),
    ],

    /*
     * Configure cooldown period for plan changes (in hours).
     */
    'plan_change_cooldown_hours' => env('BILLING_PLAN_CHANGE_COOLDOWN_HOURS', 72),

    /*
     * Configure the threat index scoring system for orders.
     */
    'threat' => [
        // Orders with a total above this value (in the billing currency) receive
        // an additional risk signal. Set via BILLING_THREAT_HIGH_VALUE_THRESHOLD.
        'high_value_threshold' => env('BILLING_THREAT_HIGH_VALUE_THRESHOLD', 50.0),
    ],
];
