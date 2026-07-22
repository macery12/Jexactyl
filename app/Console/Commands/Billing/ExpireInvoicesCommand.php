<?php

namespace Everest\Console\Commands\Billing;

use Illuminate\Console\Command;
use Everest\Models\Billing\Invoice;
use Illuminate\Support\Facades\Log;
use Everest\Services\Billing\InvoicePdfService;
use Everest\Services\Billing\InvoiceStorageService;
use Everest\Services\Billing\InvoiceSettingsService;

class ExpireInvoicesCommand extends Command
{
    protected $signature = 'p:billing:expire-invoices
                            {--dry-run : List invoices that would be expired without making changes}';

    protected $description = 'If auto-cleanup is enabled in Invoice Settings, delete invoice data snapshots '
        . 'older than the configured threshold and mark them as expired.';

    public function __construct(
        private readonly InvoiceStorageService $storageService,
        private readonly InvoiceSettingsService $settingsService,
        private readonly InvoicePdfService $pdfService,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $settings = $this->settingsService->get();

        if (!$settings->auto_cleanup_enabled) {
            $this->info('Invoice auto-cleanup is disabled. Enable it in Admin → Billing → Invoice Settings → Retention.');

            return 0;
        }

        $cutoff = now()->subYears($settings->auto_cleanup_after_years);
        $dryRun = (bool) $this->option('dry-run');

        $query = Invoice::where('status', Invoice::STATUS_ACTIVE)
            ->where('generated_at', '<', $cutoff)
            ->whereNotNull('data_path');

        if ($dryRun) {
            $count = $query->count();
            $this->info("[DRY RUN] {$count} invoice(s) older than {$settings->auto_cleanup_after_years} year(s) would be deleted.");

            return 0;
        }

        $expired = 0;
        $errors = 0;

        $query->chunkById(200, function ($invoices) use (&$expired, &$errors) {
            foreach ($invoices as $invoice) {
                try {
                    // Delete local PDF cache if present
                    if ($invoice->pdf_cached_path) {
                        $this->pdfService->evictInvoiceCache($invoice);
                        $invoice->refresh();
                    }

                    // Delete encrypted data snapshot from remote storage
                    $this->storageService->delete($invoice);

                    $invoice->update([
                        'status' => Invoice::STATUS_EXPIRED,
                        'data_path' => null,
                        'data_disk' => null,
                        'data_size_bytes' => null,
                    ]);

                    ++$expired;
                } catch (\Throwable $e) {
                    ++$errors;
                    Log::error("ExpireInvoicesCommand: Failed to expire invoice {$invoice->uuid}: " . $e->getMessage());
                }
            }
        });

        $this->info("Expired {$expired} invoice(s). Errors: {$errors}.");
        Log::info("ExpireInvoicesCommand: Expired {$expired} invoices, {$errors} errors.");

        return $errors > 0 ? 1 : 0;
    }
}
