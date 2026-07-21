<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run()
    {
        $this->call(NestSeeder::class);
        $this->call(EggSeeder::class);
        $this->call(WebhookSeeder::class);
        $this->call(EmailNotificationSettingsSeeder::class);
        $this->call(InvoiceSettingsSeeder::class);
        $this->call(ThemePresetSeeder::class);
    }
}
