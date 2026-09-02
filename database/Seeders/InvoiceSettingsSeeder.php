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
            $this->command->info('Added 0 missing invoice settings rows; found 1 existing row.');

            return;
        }

        DB::table('invoice_settings')->insert([
            'company_name' => config('app.name', ''),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->command->info('Added 1 missing invoice settings row; found 0 existing rows.');
        $this->command->line('  + Default invoice settings');
    }
}
