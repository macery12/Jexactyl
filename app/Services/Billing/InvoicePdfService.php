<?php

namespace Everest\Services\Billing;

use Barryvdh\DomPDF\Facade\Pdf;
use Everest\Models\Billing\Invoice;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Handles on-demand PDF generation and local caching for invoices.
 *
 * Flow:
 *  1. getOrGenerate()   — returns raw PDF bytes, generating + caching if needed
 *  2. generateAndCache() — decrypts snapshot, renders blade, runs dompdf, saves to local cache
 *  3. evictExpiredCache() — called hourly to delete PDFs whose 24-h TTL has expired
 *
 * The PDF is NEVER stored on S3/R2 — it lives only in storage/app/invoices/pdf-cache/
 * on the local server and is auto-deleted after PDF_CACHE_TTL_HOURS hours.
 */
class InvoicePdfService
{
    /** How long (hours) a generated PDF is kept before it must be regenerated on next download. */
    public const PDF_CACHE_TTL_HOURS = 24;

    /** Local-disk directory (relative to storage/app/) for cached PDFs. */
    public const CACHE_DIR = 'invoices/pdf-cache';

    public function __construct(
        private readonly InvoiceStorageService $storageService,
    ) {
    }

    /**
     * Return raw PDF bytes for the given invoice.
     *
     * If a valid local-cache PDF exists it is returned immediately.
     * Otherwise the snapshot is decrypted and a fresh PDF is generated,
     * cached locally for PDF_CACHE_TTL_HOURS, and then returned.
     *
     * @throws \RuntimeException if the data snapshot is missing or decryption fails
     */
    public function getOrGenerate(Invoice $invoice): string
    {
        // Serve from cache if still valid
        if ($invoice->hasCachedPdf()) {
            $cached = Storage::disk('local')->get($invoice->pdf_cached_path);
            if ($cached !== null) {
                return $cached;
            }
            // File was deleted externally — fall through to regenerate
        }

        return $this->generateAndCache($invoice);
    }

    /**
     * Decrypt the invoice data snapshot, render the PDF via dompdf, save to local
     * cache, and update the invoice record with the new cache path and expiry.
     *
     * @throws \RuntimeException if the data snapshot is missing, decryption fails, or storage fails
     */
    public function generateAndCache(Invoice $invoice): string
    {
        // Load and decrypt the snapshot from remote storage
        $data = $this->storageService->loadData($invoice);

        // Render the Blade PDF template
        $pdf = Pdf::loadView('pdf.invoice', $this->buildViewData($data));
        $pdf->setPaper('a4', 'portrait');
        $pdfContent = $pdf->output();

        // Save to local cache (storage/app/invoices/pdf-cache/{uuid}.pdf)
        $cachePath = self::CACHE_DIR . '/' . $invoice->uuid . '.pdf';
        Storage::disk('local')->put($cachePath, $pdfContent);

        // Update invoice record with cache metadata
        $invoice->update([
            'pdf_cached_path' => $cachePath,
            'pdf_cached_at' => now(),
            'pdf_expires_at' => now()->addHours(self::PDF_CACHE_TTL_HOURS),
        ]);

        Log::info("InvoicePdfService: PDF cached for invoice {$invoice->uuid}", [
            'path' => $cachePath,
            'size_bytes' => strlen($pdfContent),
            'expires_at' => now()->addHours(self::PDF_CACHE_TTL_HOURS)->toIso8601String(),
        ]);

        return $pdfContent;
    }

    /**
     * Return the full absolute path to the cached PDF file (for email attachment).
     * Returns null if no valid cache exists.
     */
    public function cachedAbsolutePath(Invoice $invoice): ?string
    {
        if (!$invoice->hasCachedPdf()) {
            return null;
        }

        $path = storage_path('app/' . $invoice->pdf_cached_path);

        return file_exists($path) ? $path : null;
    }

    /**
     * Delete the local PDF cache for a single invoice without changing its status.
     */
    public function evictInvoiceCache(Invoice $invoice): void
    {
        $this->deleteCacheFile($invoice->pdf_cached_path);

        $invoice->update([
            'pdf_cached_path' => null,
            'pdf_cached_at' => null,
            'pdf_expires_at' => null,
        ]);
    }

    /**
     * Delete expired PDF cache files for all invoices whose pdf_expires_at has passed.
     * Called by the hourly ExpirePdfCacheCommand.
     *
     * @return array{evicted: int, errors: int}
     */
    public function evictExpiredCache(): array
    {
        $evicted = 0;
        $errors = 0;

        Invoice::whereNotNull('pdf_cached_path')
            ->where('pdf_expires_at', '<=', now())
            ->chunkById(200, function ($invoices) use (&$evicted, &$errors) {
                foreach ($invoices as $invoice) {
                    try {
                        $this->deleteCacheFile($invoice->pdf_cached_path);

                        $invoice->update([
                            'pdf_cached_path' => null,
                            'pdf_cached_at' => null,
                            'pdf_expires_at' => null,
                        ]);

                        ++$evicted;
                    } catch (\Throwable $e) {
                        ++$errors;
                        Log::error("InvoicePdfService: Failed to evict cached PDF for invoice {$invoice->uuid}: " . $e->getMessage());
                    }
                }
            });

        return ['evicted' => $evicted, 'errors' => $errors];
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Build the view-data array expected by resources/views/pdf/invoice.blade.php
     * from the decrypted snapshot array.
     */
    private function buildViewData(array $data): array
    {
        return [
            // Company
            'companyName' => $data['company']['name'] ?? config('app.name'),
            'companyAddress' => $data['company']['address'] ?? '',
            'companyCity' => $data['company']['city'] ?? '',
            'companyState' => $data['company']['state'] ?? '',
            'companyZip' => $data['company']['zip'] ?? '',
            'companyCountry' => $data['company']['country'] ?? '',
            'companyLogoUrl' => $data['company']['logo_url'] ?? null,
            'companyTaxId' => $data['company']['tax_id'] ?? null,

            // Invoice header
            'invoiceNumber' => $data['invoice_number'] ?? '',
            'invoiceStatus' => $data['status'] ?? 'active',
            'generatedAt' => isset($data['generated_at'])
                ? \Carbon\Carbon::parse($data['generated_at'])->format('F j, Y')
                : now()->format('F j, Y'),
            'expiresAt' => null, // data is stored forever; no expiry shown on PDF

            // Customer
            'userName' => $data['customer']['name'] ?? $data['customer']['username'] ?? 'Customer',
            'userEmail' => $data['customer']['email'] ?? '',
            'billingFirstName' => $data['customer']['billing_address']['first_name'] ?? null,
            'billingLastName' => $data['customer']['billing_address']['last_name'] ?? null,
            'billingAddressLine1' => $data['customer']['billing_address']['address_line1'] ?? null,
            'billingAddressLine2' => $data['customer']['billing_address']['address_line2'] ?? null,
            'billingCity' => $data['customer']['billing_address']['city'] ?? null,
            'billingState' => $data['customer']['billing_address']['state'] ?? null,
            'billingPostalCode' => $data['customer']['billing_address']['postal_code'] ?? null,
            'billingCountry' => $data['customer']['billing_address']['country'] ?? null,
            'billingPhone' => $data['customer']['billing_address']['phone'] ?? null,

            // Order details
            'orderId' => $data['order_id'] ?? '',
            'orderType' => $data['order_type'] ?? '',
            'productName' => $data['product_name'] ?? 'Server',
            'billingCycle' => $data['billing_cycle'] ?? null,
            'paymentMethod' => $data['payment_method'] ?? '',
            'paymentProcessor' => $data['payment_processor'] ?? '',
            'transactionId' => $data['transaction_id'] ?? null,

            // Financials
            'currency' => $data['currency'] ?? 'USD',
            'subtotal' => $data['subtotal'] ?? 0,
            'discountAmount' => $data['discount'] ?? 0,
            'total' => $data['total'] ?? 0,
            'couponCode' => $data['coupon_code'] ?? null,

            // Footer
            'appUrl' => rtrim(config('app.url', ''), '/'),
        ];
    }

    private function deleteCacheFile(?string $relativePath): void
    {
        if (!$relativePath) {
            return;
        }

        try {
            Storage::disk('local')->delete($relativePath);
        } catch (\Throwable $e) {
            Log::warning("InvoicePdfService: Failed to delete cache file '{$relativePath}': " . $e->getMessage());
        }
    }
}
