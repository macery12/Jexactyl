<?php

namespace Everest\Services\Billing;

use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\InvoiceSettings;

class InvoiceSettingsService
{
    /**
     * Return the single settings row, creating defaults if it doesn't exist.
     */
    public function get(): InvoiceSettings
    {
        return InvoiceSettings::firstOrCreate(
            ['id' => 1],
            [
                'company_name' => config('app.name', ''),
                'invoice_prefix' => 'INV',
                'invoice_sequence' => 0,
                'storage_driver' => 'local',
                'r2_bytes_used' => 0,
                'r2_bytes_limit' => 10200547328, // 9.5 GiB
                'auto_cleanup_enabled' => false,
                'auto_cleanup_after_years' => 3,
            ]
        );
    }

    /**
     * Update the settings row with the given attributes.
     */
    public function update(array $attributes): InvoiceSettings
    {
        $settings = $this->get();
        $settings->update($attributes);

        return $settings->fresh();
    }

    /**
     * Increment r2_bytes_used atomically.
     */
    public function incrementR2Usage(int $bytes): void
    {
        DB::table('invoice_settings')->where('id', 1)->increment('r2_bytes_used', $bytes);
    }

    /**
     * Decrement r2_bytes_used atomically, clamping at 0.
     */
    public function decrementR2Usage(int $bytes): void
    {
        DB::table('invoice_settings')
            ->where('id', 1)
            ->update(['r2_bytes_used' => DB::raw('GREATEST(0, r2_bytes_used - ' . (int) $bytes . ')')]);
    }
}
