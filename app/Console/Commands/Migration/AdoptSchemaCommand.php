<?php

namespace Everest\Console\Commands\Migration;

use RuntimeException;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Everest\Services\Migration\SchemaChange;
use Everest\Services\Migration\SchemaBaseline;
use Everest\Services\Migration\SchemaReconciler;
use Everest\Services\Migration\SchemaAdoptService;

class AdoptSchemaCommand extends Command
{
    protected $description = 'Upgrade an existing install onto the consolidated migration chain.';

    protected $signature = 'p:migrate:adopt
        {--dry-run : Report exactly what would change and write nothing}
        {--keep-vestigial : Keep the subscriptions and subscription_items tables instead of dropping them}
        {--keep-extra-indexes : Keep indexes this install has that the shipped schema does not}
        {--assume-yes : Answer the confirmation prompts with yes. Required for unattended runs}';

    /**
     * Tables the rebuild dropped (D2). Both were Cashier-style leftovers with no
     * code referencing them; they are only dropped when empty.
     */
    private const VESTIGIAL_TABLES = ['subscriptions', 'subscription_items'];

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        try {
            $baseline = SchemaBaseline::load(base_path(SchemaBaseline::PATH));
            $legacyChain = SchemaBaseline::legacyChain(base_path(SchemaBaseline::LEGACY_CHAIN_PATH));
            $currentChain = SchemaBaseline::currentChain(database_path('migrations'));
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return 1;
        }

        $connection = DB::connection();
        $service = new SchemaAdoptService($connection);
        $reconciler = new SchemaReconciler($connection);

        $this->printPreamble($connection->getDatabaseName());

        if ($service->alreadyAdopted($currentChain)) {
            $this->info('This install is already on the consolidated chain — nothing to do.');

            return 0;
        }

        if (($blockers = $service->blockers($legacyChain, $currentChain)) !== []) {
            $this->error('This install cannot be upgraded yet:');
            foreach ($blockers as $blocker) {
                $this->line('');
                $this->line('  ' . str_replace("\n", "\n  ", $blocker));
            }
            $this->line('');

            return 1;
        }

        if (($problems = $reconciler->blockingDifferences($baseline)) !== []) {
            return $this->reportSchemaMismatch($problems);
        }

        $dropTables = $this->resolveVestigialTables($service);
        $changes = $reconciler->plan($baseline, $dropTables);

        if ($this->option('keep-extra-indexes')) {
            $changes = array_values(array_filter($changes, fn (SchemaChange $c) => $c->kind !== SchemaChange::KIND_DROP_INDEX));
        }

        $this->reportPlan(
            $changes,
            array_values(array_diff($reconciler->extraTables($baseline), $dropTables)),
            $service->unknownMigrations($legacyChain, $currentChain),
            $reconciler->columnOrderDifferences($baseline),
            $legacyChain,
            $currentChain,
        );

        if ($dryRun) {
            $this->line('');
            $this->info('Dry run — nothing was written. Re-run without --dry-run to apply.');

            return 0;
        }

        if (!$this->confirmRun()) {
            $this->warn('Aborted. Nothing was written.');

            return 1;
        }

        try {
            $applied = $service->applyChanges($changes);
        } catch (RuntimeException $e) {
            $this->line('');
            $this->error($e->getMessage());
            $this->line('');
            $this->reportBug();

            return 1;
        }

        $history = $service->rewriteMigrationHistory($legacyChain, $currentChain);
        $this->archiveHistory($history['archived']);

        return $this->verify($reconciler, $baseline, $applied, $history);
    }

    private function printPreamble(string $database): void
    {
        $this->line('');
        $this->warn('  ┌───────────────────────────────────────────────────────────────────┐');
        $this->warn('  │  SCHEMA ADOPTION — EXPERIMENTAL                                    │');
        $this->warn('  └───────────────────────────────────────────────────────────────────┘');
        $this->line('');
        $this->line('  This panel replaced its 327-file migration history with a consolidated');
        $this->line('  22-file one. Both build the same tables and columns, so this command');
        $this->line('  does not move any of your data — it rewrites the migration bookkeeping');
        $this->line('  and aligns a handful of index and constraint names.');
        $this->line('');
        $this->line("  Target database: {$database}");
        $this->line('');
        $this->line('  It still alters your live schema. Back the database up first, and use');
        $this->line('  --dry-run to see the exact statements before committing to them.');
        $this->line('');
        $this->reportBug();
        $this->line('');
    }

    private function reportBug(): void
    {
        $this->line('  Please report problems to the automated installer repository, with the');
        $this->line('  output of this command and the version you upgraded from attached.');
    }

    /** @param string[] $problems */
    private function reportSchemaMismatch(array $problems): int
    {
        $this->error('This database does not match the schema this panel expects, so it will not be touched.');
        $this->line('');
        $this->line('Differences found:');

        foreach (array_slice($problems, 0, 25) as $problem) {
            $this->line('  - ' . $problem);
        }

        if (count($problems) > 25) {
            $this->line(sprintf('  … and %d more.', count($problems) - 25));
        }

        $this->line('');
        $this->line('This usually means one of:');
        $this->line('  - the install is not fully migrated on the old chain (run the previous release\'s `php artisan migrate` first);');
        $this->line('  - the schema was modified by hand or by a third-party extension;');
        $this->line('  - this is not an install of this panel.');
        $this->line('');
        $this->reportBug();

        return 1;
    }

    /** @return string[] */
    private function resolveVestigialTables(SchemaAdoptService $service): array
    {
        if ($this->option('keep-vestigial')) {
            return [];
        }

        $present = array_values(array_filter(
            self::VESTIGIAL_TABLES,
            fn (string $table) => DB::getSchemaBuilder()->hasTable($table)
        ));

        // Nothing in this panel writes to them, so rows here mean something
        // unexpected does. Keep the table and say so rather than destroy it.
        $populated = $service->nonEmpty($present);

        foreach ($populated as $table => $count) {
            $this->warn(sprintf(
                '  ! `%s` holds %s row(s) but is not part of this panel\'s schema. Keeping it — export it if you need it, then drop it by hand.',
                $table,
                number_format($count),
            ));
        }

        return array_values(array_diff($present, array_keys($populated)));
    }

    /**
     * @param SchemaChange[] $changes
     * @param string[]       $extraTables
     * @param string[]       $unknownMigrations
     * @param string[]       $columnOrderTables
     * @param string[]       $legacyChain
     * @param string[]       $currentChain
     */
    private function reportPlan(
        array $changes,
        array $extraTables,
        array $unknownMigrations,
        array $columnOrderTables,
        array $legacyChain,
        array $currentChain,
    ): void {
        $this->line('');
        $this->info('Schema: every table and column already matches the shipped schema.');
        $this->line('');

        if ($changes === []) {
            $this->line('No schema changes needed.');
        } else {
            $cosmetic = array_filter($changes, fn (SchemaChange $c) => $c->isCosmetic());
            $functional = array_filter($changes, fn (SchemaChange $c) => !$c->isCosmetic());

            if ($cosmetic !== []) {
                $this->line(sprintf('Naming only — %d index/constraint name(s) still carry historical table names:', count($cosmetic)));
                foreach ($cosmetic as $change) {
                    $this->line('  · ' . $change->description);
                }
                $this->line('');
            }

            if ($functional !== []) {
                $this->line(sprintf('Structural — %d change(s):', count($functional)));
                foreach ($functional as $change) {
                    $this->line(($change->destructive ? '  ! ' : '  · ') . $change->description);
                }
                $this->line('');
            }
        }

        $this->line(sprintf(
            'Migration history: %d old row(s) will be replaced with the %d consolidated migrations.',
            count($legacyChain),
            count($currentChain),
        ));

        if ($unknownMigrations !== []) {
            $this->line('');
            $this->warn(sprintf('  ! %d migration row(s) match neither chain and will be left alone:', count($unknownMigrations)));
            foreach ($unknownMigrations as $name) {
                $this->line('      ' . $name);
            }
            $this->line('    These ran on this install but ship with no file here. Harmless, but worth knowing.');
        }

        if ($extraTables !== []) {
            $this->line('');
            $this->warn('  ! Tables present here but not in this panel\'s schema (left untouched):');
            foreach ($extraTables as $table) {
                $this->line('      ' . $table);
            }
        }

        if ($columnOrderTables !== []) {
            $this->line('');
            $this->line(sprintf(
                '  Note: %s %s the right columns in a different physical order than a fresh',
                implode(', ', array_map(fn (string $t) => "`{$t}`", $columnOrderTables)),
                count($columnOrderTables) === 1 ? 'holds' : 'hold',
            ));
            $this->line('  install, because they were added by a later ALTER. Nothing depends on column');
            $this->line('  order and this is left as it is; it only shows up when comparing dumps.');
        }

        $this->line('');
        $this->line('No row data is read or written by this command, other than the migrations table itself.');
    }

    private function confirmRun(): bool
    {
        if ($this->option('assume-yes')) {
            return true;
        }

        if (!$this->input->isInteractive()) {
            $this->error('Refusing to run unattended without --assume-yes.');

            return false;
        }

        $this->line('');

        if (!$this->confirm('Have you taken a backup of this database?', false)) {
            $this->line('Take one first, then run this again. A dry run is safe meanwhile:');
            $this->line('  php artisan p:migrate:adopt --dry-run');

            return false;
        }

        return $this->confirm('Apply these changes now?', false);
    }

    /**
     * Keep the replaced rows on disk. The operator has a backup, but having the
     * old history to hand makes it obvious what was there before.
     */
    private function archiveHistory(array $rows): void
    {
        $path = storage_path('app/migration-history-' . date('Ymd-His') . '.json');

        @file_put_contents($path, json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (is_readable($path)) {
            $this->line("  Previous migration history archived to {$path}");
        }
    }

    /**
     * @param SchemaChange[] $applied
     * @param array{removed: int, inserted: int} $history
     */
    private function verify(SchemaReconciler $reconciler, SchemaBaseline $baseline, array $applied, array $history): int
    {
        $this->line('');
        $this->line(sprintf('  Applied %d schema change(s).', count($applied)));
        $this->line(sprintf('  Migration history: removed %d row(s), inserted %d.', $history['removed'], $history['inserted']));
        $this->line('');

        $remaining = $reconciler->plan($baseline);

        if ($this->option('keep-extra-indexes') || $this->option('keep-vestigial')) {
            $remaining = array_values(array_filter(
                $remaining,
                fn (SchemaChange $c) => $c->kind !== SchemaChange::KIND_DROP_INDEX
            ));
        }

        $problems = $reconciler->blockingDifferences($baseline);

        if ($problems !== [] || $remaining !== []) {
            $this->error('Upgrade finished but the schema still differs from the shipped one:');
            foreach (array_merge($problems, array_map(fn (SchemaChange $c) => $c->description, $remaining)) as $line) {
                $this->line('  - ' . $line);
            }
            $this->line('');
            $this->reportBug();

            return 1;
        }

        $this->info('Verified: this install now matches the shipped schema exactly.');
        $this->line('');
        $this->line('Next steps:');
        $this->line('  1. `php artisan migrate` should now report nothing pending.');
        $this->line('  2. Do NOT seed — neither `php artisan db:seed` nor `migrate --seed`.');
        $this->line('     The egg seeder would overwrite any egg definitions you have customised.');
        $this->line('  3. Check the panel loads and a few servers look right.');
        $this->line('');

        return 0;
    }
}
