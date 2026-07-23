<?php

namespace Everest\Services\Billing;

use Illuminate\Support\Str;
use Everest\Models\Billing\Order;
use Everest\Models\Billing\Invoice;
use Illuminate\Support\Facades\Log;

/**
 * Creates an invoice record and persists its encrypted data snapshot.
 *
 * PDF generation is deliberately NOT done here. A PDF is generated on demand
 * by InvoicePdfService when a user downloads the invoice, or proactively by
 * GenerateInvoiceJob (for the payment-confirmation email attachment).
 */
class InvoiceGenerationService
{
    public function __construct(
        private readonly InvoiceSettingsService $settingsService,
        private readonly InvoiceStorageService $storageService,
        private readonly InvoiceNumberingService $numberingService,
    ) {
    }

    /**
     * Build an encrypted data snapshot, persist it, and create the Invoice record.
     *
     * @throws \RuntimeException if storage fails (e.g. R2 limit exceeded)
     */
    public function generate(Order $order): Invoice
    {
        $settings = $this->settingsService->get();
        $invoiceNumber = $this->numberingService->next();

        $user = $order->user;
        $product = $order->product;

        // Load billing profile PII — decrypted on access via EncryptedJson cast
        $billingProfile = $user?->billingProfile;
        $billingData = $billingProfile?->encrypted_data ?? [];

        // Human-readable labels
        $orderTypeLabels = [
            Order::TYPE_NEW => 'New Server Purchase',
            Order::TYPE_REN => 'Server Renewal',
            Order::TYPE_UPG => 'Plan Change / Upgrade',
        ];
        $orderTypeLabel = $orderTypeLabels[$order->type] ?? ucfirst((string) $order->type);

        $billingCycle = $order->billing_days
            ? ($order->billing_days . ' day' . ($order->billing_days !== 1 ? 's' : ''))
            : null;

        $paymentMethod = match ($order->payment_processor) {
            'stripe' => 'Card (Stripe)',
            'paypal' => 'PayPal',
            'free' => 'Free',
            default => ucfirst($order->payment_processor ?? 'Unknown'),
        };

        $transactionId = $order->payment_intent_id ?? $order->paypal_capture_id ?? null;
        $subtotal = $order->subtotal ?? $order->total;
        $discountAmount = $order->discount ?? 0;

        $couponCode = null;
        if ($order->coupon_id) {
            $couponCode = $order->coupon?->code;
        }

        // Build the snapshot — this is everything needed to re-render the PDF
        // at any point in the future without touching the live database.
        $snapshot = [
            'invoice_number' => $invoiceNumber,
            'status' => Invoice::STATUS_ACTIVE,
            'generated_at' => now()->toIso8601String(),

            // Company info captured at generation time (not live settings)
            'company' => [
                'name' => $settings->company_name ?: config('app.name'),
                'address' => $settings->company_address,
                'city' => $settings->company_city,
                'state' => $settings->company_state,
                'zip' => $settings->company_zip,
                'country' => $settings->company_country,
                'logo_url' => $settings->company_logo_url,
                'tax_id' => $settings->company_tax_id,
            ],

            // Customer PII — encrypted as part of the blob
            'customer' => [
                'id' => $user?->id,
                'username' => $user?->username,
                'name' => $user?->username ?? 'Customer',
                'email' => $user?->email ?? '',
                'billing_address' => $billingData ? [
                    'first_name'    => $billingData['first_name'] ?? null,
                    'last_name'     => $billingData['last_name'] ?? null,
                    'address_line1' => $billingData['address_line1'] ?? null,
                    'address_line2' => $billingData['address_line2'] ?? null,
                    'city'          => $billingData['city'] ?? null,
                    'state'         => $billingData['state'] ?? null,
                    'postal_code'   => $billingData['postal_code'] ?? null,
                    'country'       => $billingData['country'] ?? null,
                    'phone'         => $billingData['phone'] ?? null,
                ] : null,
            ],

            // Order details
            'order_id' => $order->id,
            'order_type' => $orderTypeLabel,
            'product_name' => $product?->name ?? 'Server',
            'billing_cycle' => $billingCycle,
            'payment_method' => $paymentMethod,
            'payment_processor' => ucfirst($order->payment_processor ?? ''),
            'transaction_id' => $transactionId,

            // Financials
            'currency' => strtoupper($order->paypal_currency ?? 'USD'),
            'subtotal' => $subtotal,
            'discount' => $discountAmount,
            'total' => $order->total,
            'coupon_code' => $couponCode,
        ];

        // Encrypt and store on the configured driver
        $stored = $this->storageService->storeData($snapshot, $invoiceNumber);

        $invoice = Invoice::create([
            'uuid' => Str::uuid()->toString(),
            'order_id' => $order->id,
            'user_id' => $order->user_id,
            'invoice_number' => $invoiceNumber,
            'status' => Invoice::STATUS_ACTIVE,
            'data_path' => $stored['path'],
            'data_disk' => $stored['disk'],
            'data_size_bytes' => $stored['size_bytes'],
            'total' => $order->total,
            'currency' => strtoupper($order->paypal_currency ?? 'USD'),
            'generated_at' => now(),
            'expires_at' => null, // stored forever unless auto-cleanup is enabled
        ]);

        Log::info("Invoice {$invoiceNumber} snapshot stored for order {$order->id}", [
            'invoice_uuid' => $invoice->uuid,
            'disk' => $stored['disk'],
            'size_bytes' => $stored['size_bytes'],
        ]);

        return $invoice;
    }
}
