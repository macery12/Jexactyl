<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the invoice_settings singleton row, extracted from the legacy
 * create_invoice_settings migration (database-rebuild D4). All other columns
 * take their schema defaults. Idempotent: never touches an existing row.
 */
class InvoiceSettingsSeeder extends Seeder
{
    public function run(): void
    {
        if (DB::table('invoice_settings')->exists()) {
            return;
        }

        DB::table('invoice_settings')->insert([
            'company_name' => config('app.name', ''),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
