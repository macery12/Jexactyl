<?php

namespace Everest\Console\Commands\Migration;

use RuntimeException;
use Illuminate\Console\Command;
use Illuminate\Encryption\Encrypter;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Everest\Services\Migration\TablePlan;
use Everest\Services\Migration\ImportContext;
use Everest\Services\Migration\ImportProfile;
use Everest\Services\Migration\ImportSummary;
use Everest\Services\Migration\PanelImportService;
use Everest\Services\Migration\Profiles\JexactylProfile;
use Everest\Services\Migration\Profiles\JexpanelProfile;
use Everest\Services\Migration\Profiles\PterodactylProfile;

class ImportPanelCommand extends Command
{
    protected $description = 'Import users, nodes and servers from a Pterodactyl, Jexactyl or JexPanel installation.';

    protected $signature = 'p:migrate:import
        {--from= : Source panel — pterodactyl, jexactyl or jexpanel}
        {--host=127.0.0.1 : Source database host}
        {--port=3306 : Source database port}
        {--database= : Source database name}
        {--username= : Source database username}
        {--password= : Source database password. Prefer SOURCE_DB_PASSWORD, see below}
        {--source-key= : The source panel APP_KEY. Prefer SOURCE_APP_KEY, see below}
        {--with-logs : Also import activity, audit and API logs}
        {--with-billing : Also import billing, groups and support data (JexPanel only)}
        {--dry-run : Run the whole import inside a rolled-back transaction and report what would happen}
        {--assume-yes : Answer the confirmation prompts with yes. Required for unattended runs}';

    /**
     * The source database password and APP_KEY are read from the environment in
     * preference to the command line, because anything passed as an argument is
     * visible to every user on the box via `ps`. An automated installer should
     * export these instead of passing --password / --source-key.
     */
    private const PASSWORD_ENV = 'SOURCE_DB_PASSWORD';
    private const APP_KEY_ENV = 'SOURCE_APP_KEY';

    private const CONNECTION = 'panel_import_source';

    public function handle(): int
    {
        $this->printPreamble();

        try {
            $profile = $this->resolveProfile();
            $groups = $this->resolveGroups($profile);
            $context = $this->makeContext();
            $source = $this->connectToSource();
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return 1;
        }

        $service = new PanelImportService(DB::connection());
        $dryRun = (bool) $this->option('dry-run');

        $this->line('');
        $this->info("Source     : {$profile->name()} {$profile->supportedVersion()} on {$this->option('host')}/{$this->option('database')}");
        $this->info('Importing  : ' . implode(', ', $groups));
        $this->line('');

        try {
            $preflight = $service->preflight($profile, $source, $context, $groups);
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return 1;
        }

        $this->reportBeforehand($profile, $preflight);

        if (!$dryRun && !$this->confirmDestructiveRun()) {
            $this->warn('Aborted. Nothing was written.');

            return 1;
        }

        $this->line($dryRun ? 'Running import in dry-run mode…' : 'Importing…');

        try {
            $summary = $service->import($profile, $source, $context, $groups, $dryRun);
        } catch (\Throwable $e) {
            $this->line('');
            $this->error('Import failed and was rolled back — the database is unchanged.');
            $this->error($e->getMessage());
            $this->line('');
            $this->reportBug();

            return 1;
        }

        $this->reportResult($summary, $dryRun);

        if (!$dryRun) {
            $this->seedPanelDefaults();
        }

        $this->printNextSteps($dryRun);

        return 0;
    }

    private function printPreamble(): void
    {
        $this->line('');
        $this->warn('  ┌───────────────────────────────────────────────────────────────────┐');
        $this->warn('  │  PANEL IMPORT — EXPERIMENTAL                                       │');
        $this->warn('  └───────────────────────────────────────────────────────────────────┘');
        $this->line('');
        $this->line('  This tool is new and lightly tested. It may fail to migrate some data');
        $this->line('  correctly, and not everything from the source panel has an equivalent');
        $this->line('  here — anything that does not is reported before you commit to it.');
        $this->line('');
        $this->line('  It writes into THIS panel\'s database. Back that database up first.');
        $this->line('  The source panel is only ever read from, never modified.');
        $this->line('');
        $this->reportBug();
        $this->line('');
    }

    private function reportBug(): void
    {
        $this->line('  Please report problems to the automated installer repository, with the');
        $this->line('  output of this command and your source panel version attached.');
    }

    private function resolveProfile(): ImportProfile
    {
        $profiles = [];
        foreach ([new PterodactylProfile(), new JexactylProfile(), new JexpanelProfile()] as $profile) {
            $profiles[$profile->key()] = $profile;
        }

        $from = $this->option('from');

        if (!$from && $this->input->isInteractive()) {
            $from = $this->choice('Which panel are you importing from?', array_keys($profiles));
        }

        if (!isset($profiles[$from])) {
            throw new RuntimeException('--from must be one of: ' . implode(', ', array_keys($profiles)));
        }

        return $profiles[$from];
    }

    /**
     * @return string[]
     */
    private function resolveGroups(ImportProfile $profile): array
    {
        $groups = [TablePlan::GROUP_CORE];

        if ($this->option('with-logs')) {
            $groups[] = TablePlan::GROUP_LOGS;
        }

        if ($this->option('with-billing')) {
            if (!$profile instanceof JexpanelProfile) {
                throw new RuntimeException(
                    "--with-billing is only supported for JexPanel. {$profile->name()}'s billing data has no equivalent in this panel."
                );
            }

            $groups[] = TablePlan::GROUP_BILLING;
        }

        return $groups;
    }

    private function connectToSource()
    {
        $database = $this->option('database') ?: $this->askRequired('Source database name');
        $username = $this->option('username') ?: $this->askRequired('Source database username');
        $password = $this->secretOption('password', self::PASSWORD_ENV, 'Source database password');

        Config::set('database.connections.' . self::CONNECTION, [
            'driver' => 'mysql',
            'host' => $this->option('host'),
            'port' => $this->option('port'),
            'database' => $database,
            'username' => $username,
            'password' => $password,
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'strict' => false,
        ]);

        DB::purge(self::CONNECTION);
        $connection = DB::connection(self::CONNECTION);

        try {
            $connection->getPdo();
        } catch (\Throwable $e) {
            throw new RuntimeException('Could not connect to the source database: ' . $e->getMessage());
        }

        return $connection;
    }

    private function makeContext(): ImportContext
    {
        $key = $this->secretOption('source-key', self::APP_KEY_ENV, 'Source panel APP_KEY (from its .env)');

        if (!$key) {
            throw new RuntimeException(
                'The source panel APP_KEY is required — node tokens and stored passwords are encrypted with it.'
            );
        }

        return new ImportContext($this->makeEncrypter($key), app('encrypter'));
    }

    private function makeEncrypter(string $appKey): Encrypter
    {
        if (str_starts_with($appKey, 'base64:')) {
            $appKey = base64_decode(substr($appKey, 7));
        }

        // The cipher follows the key length; every panel in this family uses
        // Laravel's AES-CBC defaults.
        $cipher = match (strlen($appKey)) {
            32 => 'AES-256-CBC',
            16 => 'AES-128-CBC',
            default => throw new RuntimeException(
                'The source APP_KEY is not a valid Laravel key — expected a 16 or 32 byte key, usually written as base64:…'
            ),
        };

        return new Encrypter($appKey, $cipher);
    }

    private function reportBeforehand(ImportProfile $profile, ImportSummary $preflight): void
    {
        foreach ($preflight->warnings as $warning) {
            $this->warn('  ! ' . wordwrap($warning, 100, "\n    "));
            $this->line('');
        }

        if ($preflight->skipped !== []) {
            $this->line('Tables in the source that will NOT be imported:');
            foreach ($preflight->skipped as $table => $reason) {
                $this->line("  - {$table}: {$reason}");
            }
            $this->line('');
        }
    }

    private function confirmDestructiveRun(): bool
    {
        if ($this->option('assume-yes')) {
            return true;
        }

        if (!$this->input->isInteractive()) {
            $this->error('Refusing to import unattended without --assume-yes.');

            return false;
        }

        $this->warn('This writes into this panel\'s database and cannot be undone from here.');

        if (!$this->confirm('Have you taken a backup of THIS panel\'s database?', false)) {
            $this->line('Take one first, then run this again. A dry run is safe meanwhile:');
            $this->line('  php artisan p:migrate:import --dry-run …');

            return false;
        }

        return $this->confirm('Import now?', false);
    }

    private function reportResult(ImportSummary $summary, bool $dryRun): void
    {
        $this->line('');

        if ($summary->copied !== []) {
            $rows = [];
            foreach ($summary->copied as $table => $count) {
                $rows[] = [$table, number_format($count)];
            }
            $this->table([$dryRun ? 'Table (not written)' : 'Table', 'Rows'], $rows);
        }

        $this->line(sprintf(
            '%s %s rows across %d tables.',
            $dryRun ? 'Would import' : 'Imported',
            number_format($summary->totalRows()),
            count($summary->copied)
        ));

        $lossy = $summary->lossyColumns();
        if ($lossy !== []) {
            $this->line('');
            $this->warn('Data in the source that was NOT carried over:');
            foreach ($lossy as $drop) {
                $this->line(sprintf('  - %s.%s (%s rows): %s', $drop['table'], $drop['column'], number_format($drop['rows']), $drop['reason']));
            }
        }

        foreach ($summary->notes as $note) {
            $this->line('  ' . $note);
        }
    }

    /**
     * Seed the tables this panel has and the source panel does not. A full seed
     * run must NOT happen after an import — whether as db:seed or migrate
     * --seed. Its egg seeder updates eggs by UUID and would overwrite imported
     * egg definitions with the shipped ones.
     */
    private function seedPanelDefaults(): void
    {
        $this->line('');
        $this->line('Seeding this panel\'s own defaults (notification settings, invoice settings, theme presets)…');

        foreach ([
            \Database\Seeders\EmailNotificationSettingsSeeder::class,
            \Database\Seeders\InvoiceSettingsSeeder::class,
            \Database\Seeders\ThemePresetSeeder::class,
        ] as $seeder) {
            $this->callSilent('db:seed', ['--class' => $seeder, '--force' => true]);
        }
    }

    private function printNextSteps(bool $dryRun): void
    {
        $this->line('');

        if ($dryRun) {
            $this->info('Dry run complete — nothing was written. Re-run without --dry-run to import.');

            return;
        }

        $this->info('Import complete.');
        $this->line('');
        $this->line('Next steps:');
        $this->line('  1. Do NOT seed — neither `php artisan db:seed` nor `migrate --seed`.');
        $this->line('     Either would overwrite the imported eggs.');
        $this->line('  2. Configure this panel\'s settings (mail, billing, branding) — they are not imported.');
        $this->line('  3. Point each node\'s Wings at this panel and restart it. Node tokens were');
        $this->line('     re-encrypted for this panel, so regenerate each node\'s configuration:');
        $this->line('       php artisan p:node:configuration');
        $this->line('  4. Check a few servers in the UI before letting users back in.');
        $this->line('');
        $this->reportBug();
    }

    private function askRequired(string $question): string
    {
        if (!$this->input->isInteractive()) {
            throw new RuntimeException("Missing required option for: {$question}");
        }

        $value = $this->ask($question);

        if (!$value) {
            throw new RuntimeException("{$question} is required.");
        }

        return $value;
    }

    /**
     * Read a secret from --option, then the environment, then an interactive
     * prompt. Passing it as an option works but is discouraged: it is visible
     * in the process list and shell history.
     */
    private function secretOption(string $option, string $env, string $question): ?string
    {
        if ($value = $this->option($option)) {
            $this->warn("Reading {$option} from the command line — it is visible in `ps` and your shell history. Prefer the {$env} environment variable.");

            return $value;
        }

        if ($value = getenv($env)) {
            return $value;
        }

        if ($this->input->isInteractive()) {
            return $this->secret($question);
        }

        throw new RuntimeException("{$question} is required. Set {$env} for unattended runs.");
    }
}
