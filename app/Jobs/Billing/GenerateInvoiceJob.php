<?php

namespace Everest\Jobs\Billing;

use Everest\Jobs\Job;
use Everest\Models\Billing\Order;
use Illuminate\Support\Facades\Log;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\Attributes\Timeout;
use Illuminate\Queue\InteractsWithQueue;
use Everest\Events\Email\PaymentReceived;
use Illuminate\Queue\Attributes\UniqueFor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Everest\Services\Billing\InvoicePdfService;
use Everest\Services\Billing\InvoiceGenerationService;

/**
 * Runs on the `critical` lane: this is the customer's receipt, and it must not
 * sit behind an hour-long modpack install.
 *
 * Unique per order so a duplicated dispatch — a webhook replay, a retried
 * fulfillment — cannot mint two invoices for the same payment.
 */
#[Timeout(120)]
#[UniqueFor(3600)]
class GenerateInvoiceJob extends Job implements ShouldQueue, ShouldBeUnique
{
    use Dispatchable;
    use InteractsWithQueue;
    use SerializesModels;

    public $tries = 3;
    public $backoff = [30, 120, 300];

    public function uniqueId(): string
    {
        return (string) $this->orderId;
    }

    public function __construct(
        public readonly int $orderId,
        public readonly float $amount,
        public readonly string $currency,
        public readonly string $paymentMethod,
        public readonly string $correlationId,
        public readonly bool $isRenewal,
        public readonly ?float $originalAmount,
        public readonly ?float $discountAmount,
        public readonly ?string $couponCode,
        public readonly ?int $billingDays,
    ) {
    }

    public function handle(
        InvoiceGenerationService $generationService,
        InvoicePdfService $pdfService,
    ): void {
        $order = Order::with(['user', 'product', 'coupon'])->find($this->orderId);

        if (!$order || !$order->user) {
            Log::warning("GenerateInvoiceJob: Order {$this->orderId} or its user not found.");

            return;
        }

        $invoice = null;
        $invoiceId = (string) $this->orderId;
        $invoiceDownloadUrl = null;
        $invoiceAbsPath = null;
        $invoiceFileName = null;

        try {
            // Step 1: Build snapshot, encrypt, store on S3/R2/local
            $invoice = $generationService->generate($order);
            $invoiceId = $invoice->invoice_number;

            // Step 2: Generate PDF and cache locally for 24 h (used as email attachment)
            $pdfService->generateAndCache($invoice);
            $invoice->refresh(); // pick up pdf_cached_path set by generateAndCache()

            $invoiceAbsPath = $pdfService->cachedAbsolutePath($invoice);
            $invoiceFileName = $invoice->invoice_number . '.pdf';

            // Serve the invoice through the client download endpoint
            $invoiceDownloadUrl = url("/api/client/billing/invoices/{$invoice->uuid}/download");
        } catch (\Throwable $e) {
            Log::error("GenerateInvoiceJob: Invoice generation failed for order {$this->orderId}: " . $e->getMessage(), [
                'exception' => $e,
                'attempt' => $this->attempts(),
            ]);

            // Snapshot/PDF failures are usually a transient object-store or
            // renderer problem, so retry while attempts remain rather than
            // silently shipping a receipt with no invoice attached. On the last
            // attempt fall through: the customer still gets their payment
            // confirmation, just without the PDF.
            if ($this->attempts() < $this->tries) {
                throw $e;
            }
        }

        // Step 3: Dispatch PaymentReceived email event
        try {
            event(new PaymentReceived(
                user: $order->user,
                amount: $this->amount,
                currency: $this->currency,
                paymentMethod: $this->paymentMethod,
                invoiceId: $invoiceId,
                correlationId: $this->correlationId,
                isRenewal: $this->isRenewal,
                originalAmount: $this->originalAmount,
                discountAmount: $this->discountAmount,
                couponCode: $this->couponCode,
                billingDays: $this->billingDays,
                invoiceDownloadUrl: $invoiceDownloadUrl,
                // PDF is at a local absolute path; the email listener reads and attaches it
                invoiceFilePath: $invoiceAbsPath,
                invoiceFileDisk: null, // local absolute path — no disk lookup needed
                invoiceFileName: $invoiceFileName,
            ));
        } catch (\Throwable $e) {
            Log::error("GenerateInvoiceJob: Failed to dispatch PaymentReceived for order {$this->orderId}: " . $e->getMessage());
        }
    }
}
