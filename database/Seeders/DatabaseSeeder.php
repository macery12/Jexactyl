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

        $eggSeeder = $this->resolveEggSeeder();
        $eggSeeder->__invoke(['deferOverwrite' => true]);

        $this->call(WebhookSeeder::class);
        $this->call(EmailNotificationSettingsSeeder::class);
        $this->call(InvoiceSettingsSeeder::class);

        $themePresetSeeder = $this->resolveThemePresetSeeder();
        $themePresetSeeder->__invoke(['deferOverwrite' => true]);

        if (!$eggSeeder->hasExistingRecords() && !$themePresetSeeder->hasExistingRecords()) {
            return;
        }

        $this->command->newLine();
        $this->command->alert('Overwrite Review');
        $this->command->comment('All missing records have been added. Existing records remain unchanged unless approved below.');

        // Collect every answer first so no more seeding output appears between questions.
        $overwriteEggs = $eggSeeder->confirmOverwrite();
        $overwriteThemePresets = $themePresetSeeder->confirmOverwrite();

        $eggSeeder->applyOverwrite($overwriteEggs);
        $themePresetSeeder->applyOverwrite($overwriteThemePresets);
    }

    private function resolveEggSeeder(): EggSeeder
    {
        $seeder = $this->container->make(EggSeeder::class);
        $seeder->setContainer($this->container);
        $seeder->setCommand($this->command);

        return $seeder;
    }

    private function resolveThemePresetSeeder(): ThemePresetSeeder
    {
        $seeder = $this->container->make(ThemePresetSeeder::class);
        $seeder->setContainer($this->container);
        $seeder->setCommand($this->command);

        return $seeder;
    }
}
