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

        if (($blockers = $service->blockers()) !== []) {
            $this->error('This install cannot be upgraded yet:');
            foreach ($blockers as $blocker) {
                $this->line('');
                $this->line('  ' . str_replace("\n", "\n  ", $blocker));
            }
            $this->line('');

            return 1;
        }

        $dropTables = $this->resolveVestigialTables($service);

        // Recomputes the plan from the live schema every time it is called. The
        // apply loop uses this between phases, and the run ends with one last
        // call to see what is genuinely left.
        $replan = function () use ($reconciler, $baseline, $dropTables): array {
            $reconciler->refresh();
            $changes = $reconciler->plan($baseline, $dropTables);

            if ($this->option('keep-extra-indexes')) {
                $changes = array_filter($changes, fn (SchemaChange $c) => $c->kind !== SchemaChange::KIND_DROP_INDEX);
            }

            return array_values($changes);
        };

        $changes = $replan();
        $unrepairable = $reconciler->unrepairableDifferences($baseline);

        if ($changes === [] && $unrepairable === [] && $service->alreadyAdopted($currentChain)) {
            $this->info('This install already matches the shipped schema and is on the consolidated chain — nothing to do.');

            return 0;
        }

        $this->reportPlan(
            $changes,
            $unrepairable,
            $reconciler->toleratedDifferences($baseline),
            array_values(array_diff($reconciler->extraTables($baseline), $dropTables)),
            $service->unknownMigrations($legacyChain, $currentChain),
            $service->historyGap($legacyChain),
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

        $this->line('');

        $result = $service->applyPlan($replan, function (SchemaChange $change) {
            $this->line('  ✔ ' . $change->description);
        });

        return $this->finish($service, $reconciler, $baseline, $replan, $result, $legacyChain, $currentChain);
    }

    /**
     * Decide what the run achieved, rewrite the bookkeeping if it earned the
     * right to, and say what is left.
     *
     * @param callable(): SchemaChange[] $replan
     * @param array{applied: SchemaChange[], failed: array} $result
     * @param string[] $legacyChain
     * @param string[] $currentChain
     */
    private function finish(
        SchemaAdoptService $service,
        SchemaReconciler $reconciler,
        SchemaBaseline $baseline,
        callable $replan,
        array $result,
        array $legacyChain,
        array $currentChain,
    ): int {
        $remaining = $replan();
        $unrepairable = $reconciler->unrepairableDifferences($baseline);

        $this->line('');
        $this->line(sprintf('  Applied %d schema change(s).', count($result['applied'])));

        if ($result['failed'] !== []) {
            $this->reportFailures($result['failed']);
        }

        // The migration history is the panel's claim about what this schema is.
        // Rewriting it while the schema still differs would make every later
        // upgrade trust a description that is not true, so that claim is only
        // made once it is earned.
        if ($remaining !== [] || $unrepairable !== []) {
            $this->line('');
            $this->error('Could not bring this install fully in line with the shipped schema.');
            $this->line('');
            $this->line('Left over:');

            foreach ($remaining as $change) {
                $this->line('  - ' . $change->description);
            }

            foreach ($unrepairable as $problem) {
                $this->line('  - ' . $problem);
            }

            $this->line('');
            $this->line('  The migration history was left as it was, so this install is not yet');
            $this->line('  claiming to be on the consolidated chain. Everything above was applied');
            $this->line('  and is safe to keep; fix what is listed and run this command again to');
            $this->line('  finish the job — it recomputes the remainder from the live schema.');
            $this->line('');
            $this->reportBug();

            return 1;
        }

        $history = $service->rewriteMigrationHistory($legacyChain, $currentChain);
        $this->archiveHistory($history['archived']);

        $this->line(sprintf('  Migration history: removed %d row(s), inserted %d.', $history['removed'], $history['inserted']));
        $this->line('');
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

    /** @param array<array{change: SchemaChange, statement: string, error: string}> $failures */
    private function reportFailures(array $failures): void
    {
        $this->line('');
        $this->warn(sprintf('  ! %d change(s) could not be applied:', count($failures)));

        foreach ($failures as $failure) {
            $this->line('');
            $this->line('    ' . $failure['change']->description);
            $this->line('      statement: ' . $failure['statement']);
            $this->line('      ' . $failure['error']);
        }
    }

    private function printPreamble(string $database): void
    {
        $this->line('');
        $this->warn('  ┌───────────────────────────────────────────────────────────────────┐');
        $this->warn('  │  SCHEMA ADOPTION — EXPERIMENTAL                                    │');
        $this->warn('  └───────────────────────────────────────────────────────────────────┘');
        $this->line('');
        $this->line('  This panel replaced its long migration history with a consolidated one.');
        $this->line('  This command compares your live schema against the schema this version');
        $this->line('  ships, builds whatever is missing, aligns index and constraint names,');
        $this->line('  and then rewrites the migration bookkeeping to match.');
        $this->line('');
        $this->line('  It works from what your database actually contains, so it does not matter');
        $this->line('  how far along the old history this install got. Anything it cannot safely');
        $this->line('  fix is listed at the end rather than forced.');
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
     * @param string[] $unrepairable
     * @param string[] $tolerated
     * @param string[] $extraTables
     * @param string[] $unknownMigrations
     * @param string[] $historyGap
     * @param string[] $columnOrderTables
     * @param string[] $legacyChain
     * @param string[] $currentChain
     */
    private function reportPlan(
        array $changes,
        array $unrepairable,
        array $tolerated,
        array $extraTables,
        array $unknownMigrations,
        array $historyGap,
        array $columnOrderTables,
        array $legacyChain,
        array $currentChain,
    ): void {
        $this->line('');

        if ($historyGap !== []) {
            $this->line(sprintf(
                'This install did not run %d of the %d old migrations — it stopped part-way along the',
                count($historyGap),
                count($legacyChain),
            ));
            $this->line('development branch. That is fine: what gets built below comes from comparing');
            $this->line('your live schema against the shipped one, not from that list.');
            $this->line('');
        }

        if ($changes === []) {
            $this->info('Schema: already matches the shipped schema. No changes needed.');
        } else {
            $cosmetic = array_filter($changes, fn (SchemaChange $c) => $c->isCosmetic());
            $functional = array_filter($changes, fn (SchemaChange $c) => !$c->isCosmetic());

            if ($functional !== []) {
                $this->line(sprintf('Structural — %d change(s):', count($functional)));
                foreach ($functional as $change) {
                    $this->line(($change->destructive ? '  ! ' : '  · ') . $change->description);
                }
                $this->line('');
            }

            if ($cosmetic !== []) {
                $this->line(sprintf('Naming only — %d index/constraint name(s) still carry historical table names:', count($cosmetic)));
                foreach ($cosmetic as $change) {
                    $this->line('  · ' . $change->description);
                }
                $this->line('');
            }
        }

        if ($unrepairable !== []) {
            $this->line('');
            $this->warn(sprintf('  ! %d difference(s) this command will not touch:', count($unrepairable)));
            foreach ($unrepairable as $problem) {
                $this->line('      ' . $problem);
            }
            $this->line('');
            $this->line('    Every other change listed above is still applied. The migration history');
            $this->line('    is only rewritten once these are resolved.');
        }

        if ($tolerated !== []) {
            $this->line('');
            $this->line(sprintf('  %d column(s) exist here but not in the shipped schema, and are kept:', count($tolerated)));
            foreach ($tolerated as $note) {
                $this->line('      ' . $note);
            }
        }

        $this->line('');
        $this->line(sprintf(
            'Migration history: up to %d old row(s) will be replaced with the %d consolidated migrations.',
            count($legacyChain) - count($historyGap),
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
        $this->line('No row data is read or written by this command, other than the migrations table');
        $this->line('itself — except where a line above is marked `!`, which flags exactly the cases');
        $this->line('where existing rows are touched.');
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
}
