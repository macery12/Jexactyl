<?php

namespace Everest\Console\Commands\Billing;

use Illuminate\Console\Command;
use Everest\Services\Billing\InvoicePdfService;

class ExpirePdfCacheCommand extends Command
{
    protected $signature = 'p:billing:expire-pdf-cache
                            {--dry-run : Show how many cached PDFs would be evicted without deleting them}';

    protected $description = 'Delete locally-cached invoice PDFs whose 24-hour TTL has expired.';

    public function __construct(private readonly InvoicePdfService $pdfService)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        if ($this->option('dry-run')) {
            $count = \Everest\Models\Billing\Invoice::whereNotNull('pdf_cached_path')
                ->where('pdf_expires_at', '<=', now())
                ->count();
            $this->info("[DRY RUN] {$count} cached PDF(s) would be evicted.");

            return 0;
        }

        ['evicted' => $evicted, 'errors' => $errors] = $this->pdfService->evictExpiredCache();

        $this->info("Evicted {$evicted} cached PDF(s). Errors: {$errors}.");

        return $errors > 0 ? 1 : 0;
    }
}
