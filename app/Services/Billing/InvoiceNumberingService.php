<?php

namespace Everest\Services\Billing;

use Illuminate\Support\Facades\DB;

class InvoiceNumberingService
{
    /**
     * Atomically allocate the next invoice number for the current year.
     *
     * Format: {PREFIX}-{YEAR}-{6-digit-sequence}
     * Example: INV-2026-000001
     *
     * Uses a DB-level lock on the invoice_settings row so concurrent requests
     * cannot allocate the same number.
     */
    public function next(): string
    {
        return DB::transaction(function () {
            // Acquire an exclusive lock on the settings row
            $settings = DB::table('invoice_settings')->lockForUpdate()->first();

            if (!$settings) {
                throw new \RuntimeException('Invoice settings row not found. Run migrations.');
            }

            $currentYear = (int) date('Y');
            $prefix = $settings->invoice_prefix ?: 'INV';
            $nextSeq = $settings->invoice_sequence + 1;

            DB::table('invoice_settings')
                ->where('id', $settings->id)
                ->update([
                    'invoice_sequence' => $nextSeq,
                    'updated_at' => now(),
                ]);

            return sprintf('%s-%d-%06d', $prefix, $currentYear, $nextSeq);
        });
    }
}
