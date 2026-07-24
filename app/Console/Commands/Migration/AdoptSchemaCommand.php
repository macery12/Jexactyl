<?php

namespace Everest\Console\Commands\Migration;

use Everest\Models\Setting;
use Everest\Models\JGuardEntry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Everest\Services\Migration\SchemaChange;
use Everest\Services\Migration\SchemaBaseline;
use Everest\Services\Migration\SchemaReconciler;
use Everest\Services\Migration\ColumnRemediation;
use Everest\Services\Migration\SchemaAdoptService;

class AdoptSchemaCommand extends Command
{
    protected $description = 'Upgrade an existing install onto the consolidated migration chain.';

    protected $signature = 'p:migrate:adopt
        {--dry-run : Report exactly what would change and write nothing}
        {--keep-vestigial : Keep the subscriptions and subscription_items tables instead of dropping them}
        {--keep-extra-indexes : Keep indexes this install has that the shipped schema does not}
        {--assume-yes : Answer the confirmation prompts with yes. Required for unattended runs}
        {--force : Reconcile again even though this install has already been adopted}';

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
        } catch (\RuntimeException $e) {
            $this->error($e->getMessage());

            return 1;
        }

        $connection = DB::connection();
        $service = new SchemaAdoptService($connection);
        $reconciler = new SchemaReconciler($connection);

        $adopted = $service->isAdopted($legacyChain, $currentChain);

        $this->printPreamble($connection->getDatabaseName(), $adopted);

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
        $remediations = $reconciler->remediations($baseline);
        $unrepairable = $reconciler->unrepairableDifferences($baseline);

        // Adoption is a one-time step, and the migration history is how the
        // install records that it happened. Once that record is there, a second
        // run must not present itself as a first-time upgrade — not even when
        // the schema has since drifted, because replaying the first-time plan
        // over an adopted install is how an operator ends up re-confirming
        // prompts they already answered.
        if ($adopted && !$this->option('force')) {
            return $this->reportAlreadyAdopted($changes, $remediations, $unrepairable);
        }

        if ($adopted) {
            $this->warn('  ! This install is already on the consolidated chain; --force is reconciling it again.');
            $this->line('    The migration history is already correct, so only the schema below changes.');
        }

        $this->reportPlan(
            $changes,
            $remediations,
            $unrepairable,
            $reconciler->toleratedDifferences($baseline),
            array_values(array_diff($reconciler->extraTables($baseline), $dropTables)),
            $service->unknownMigrations($legacyChain, $currentChain),
            $service->historyGap($legacyChain),
            $reconciler->columnOrderDifferences($baseline),
            $legacyChain,
            $currentChain,
            $adopted,
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

        // Data decisions come first: filling and remapping rows so the columns
        // they belong to are safe to alter, before the schema plan runs.
        if ($remediations !== []) {
            $this->runRemediations($service, $remediations);
            $reconciler->refresh();
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
        $remediations = $reconciler->remediations($baseline);
        $unrepairable = $reconciler->unrepairableDifferences($baseline);

        $this->line('');
        $this->line(sprintf('  Applied %d schema change(s).', count($result['applied'])));

        if ($result['failed'] !== []) {
            $this->reportFailures($result['failed']);
        }

        // The migration history is the panel's claim about what this schema is.
        // Rewriting it while the schema still differs — including a data decision
        // that was skipped rather than made — would make every later upgrade
        // trust a description that is not true, so that claim is only made once
        // it is earned.
        if ($remaining !== [] || $remediations !== [] || $unrepairable !== []) {
            $this->line('');
            $this->error('Could not bring this install fully in line with the shipped schema.');
            $this->line('');
            $this->line('Left over:');

            foreach ($remaining as $change) {
                $this->line('  - ' . $change->description);
            }

            foreach ($remediations as $remediation) {
                $this->line('  - ' . $remediation->target() . ': needs a data decision (see above)');
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
        $this->line('  This was a one-time step. Upgrade this install with `php artisan migrate`');
        $this->line('  from now on — running `p:migrate:adopt` again will say so and stop.');
        $this->line('');

        return 0;
    }

    /**
     * The second-run path. This install has already been adopted, so the only
     * question left is whether its schema still matches — and either way the
     * answer ends by pointing at `php artisan migrate`, which is how it is
     * upgraded from here on.
     *
     * @param SchemaChange[] $changes
     * @param ColumnRemediation[] $remediations
     * @param string[] $unrepairable
     */
    private function reportAlreadyAdopted(array $changes, array $remediations, array $unrepairable): int
    {
        $this->info('  ✔ Already adopted — this install is on the consolidated migration chain.');

        if (($at = $this->previousRunAt()) !== null) {
            $this->line("    The last adoption run on this machine was {$at}.");
        }

        if ($changes === [] && $remediations === [] && $unrepairable === []) {
            $this->line('    Its schema still matches the shipped one exactly, so there is nothing to do.');
            $this->line('');
            $this->line('  Upgrade this install the ordinary way from now on:');
            $this->line('');
            $this->line('      php artisan migrate');
            $this->line('');
            $this->line('  `p:migrate:adopt` is a one-time step and does not need to be run again.');
            $this->line('');

            return 0;
        }

        $outstanding = count($changes) + count($remediations) + count($unrepairable);

        $this->line('');
        $this->warn(sprintf('  ! Its schema has drifted from the shipped one since — %d difference(s):', $outstanding));
        $this->line('');

        foreach ($changes as $change) {
            $this->line(($change->destructive ? '    ! ' : '    · ') . $change->description);
        }

        foreach ($remediations as $remediation) {
            $this->line('    · ' . $remediation->target() . ': needs a data decision');
        }

        foreach ($unrepairable as $problem) {
            $this->line('    · ' . $problem);
        }

        $this->line('');
        $this->line('  The bookkeeping is already correct, so this is drift that appeared after');
        $this->line('  adoption — not an unfinished upgrade. Run the ordinary upgrade first, in');
        $this->line('  case a migration added since accounts for it:');
        $this->line('');
        $this->line('      php artisan migrate');
        $this->line('');
        $this->line('  If the list above survives that, re-run this command with --force to');
        $this->line('  reconcile it. Nothing was written by this run.');
        $this->line('');

        return 1;
    }

    /**
     * When adoption last ran here, as far as anything on disk can say. The
     * `migrations` table carries no timestamp, so the evidence is the history
     * archive written on the way out; absent if it was cleaned up, which is why
     * this only decorates the message rather than deciding anything.
     */
    private function previousRunAt(): ?string
    {
        $archives = glob($this->archivePrefix() . '*.json') ?: [];

        if ($archives === []) {
            return null;
        }

        sort($archives);
        $stamp = \DateTimeImmutable::createFromFormat(
            'Ymd-His',
            basename(substr((string) end($archives), strlen($this->archivePrefix())), '.json'),
        );

        return $stamp === false ? null : $stamp->format('Y-m-d H:i:s');
    }

    /**
     * Archives are named per database. One machine routinely holds several — a
     * live one and a restored clone being rehearsed against — and an archive
     * from the wrong one would date an adoption that never happened here.
     */
    private function archivePrefix(): string
    {
        $database = (string) preg_replace('/[^A-Za-z0-9_-]/', '_', DB::connection()->getDatabaseName());

        return storage_path("app/migration-history-{$database}-");
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

    /**
     * Dry-run view of the data decisions the real run will walk through. Shows
     * what is there now and what the default would do, so the operator knows
     * what they are agreeing to before anything prompts them.
     *
     * @param ColumnRemediation[] $remediations
     */
    private function reportRemediations(array $remediations): void
    {
        $this->line('');
        $this->warn(sprintf('  ? %d column(s) need a data decision before the schema can change:', count($remediations)));

        foreach ($remediations as $r) {
            $this->line('');
            $this->line(sprintf('    %s — %s → %s', $r->target(), $r->currentType, $r->targetType));
            $this->line('      ' . wordwrap($r->explanation, 78, "\n      ", true));

            if ($this->isUserStateRemap($r)) {
                $this->previewUserStateRemap();

                continue;
            }

            if ($r->kind === ColumnRemediation::KIND_VALUE_REMAP) {
                $this->line('      values present now:');
                foreach ($r->distribution as $value => $count) {
                    $this->line(sprintf('        `%s` — %s row(s)', $value, number_format($count)));
                }
                $this->line('      You will be asked, per value, whether it means '
                    . implode(', ', $r->meaningfulTargets) . ', or a normal account.');
            } else {
                $this->line(sprintf(
                    '      %s row(s) are NULL; the default fill is %s. You can change it when prompted.',
                    number_format($r->nullCount),
                    $r->proposedFill === null ? 'unset (you must supply one)' : "`{$r->proposedFill}`",
                ));
            }
        }
    }

    /**
     * Walk each data decision with the operator, build the SQL from their
     * answers, and apply it. Runs before the schema plan, so by the time the
     * columns are altered their rows already fit.
     *
     * @param ColumnRemediation[] $remediations
     */
    private function runRemediations(SchemaAdoptService $service, array $remediations): void
    {
        $this->line('');
        $this->line('Data decisions:');

        foreach ($remediations as $r) {
            $this->line('');
            $this->line('  ' . $r->target() . ':');
            $this->line('  ' . wordwrap($r->explanation, 74, "\n  ", true));

            // `users.state` gets the guided cohort walk instead of the generic
            // per-value prompt: it knows `0` is the live account and every other
            // code is the old suspended/pending pool, so one decision covers all.
            if ($this->isUserStateRemap($r)) {
                $this->remapUserState($service, $r);

                continue;
            }

            $statements = $r->kind === ColumnRemediation::KIND_VALUE_REMAP
                ? $this->planValueRemap($r)
                : $this->planNullFill($r);

            if ($statements === []) {
                $this->warn('    · left as-is; it will be listed as still outstanding.');

                continue;
            }

            try {
                foreach ($statements as $statement) {
                    $service->run($statement);
                    $this->line('    ✔ ' . $statement);
                }
            } catch (\Throwable $e) {
                // A failed fix leaves the column short of the target, so the
                // schema plan will leave it outstanding and the history rewrite
                // is held back. Report and move on rather than crash.
                $this->warn('    ! could not apply: ' . $e->getMessage());
            }
        }
    }

    /**
     * Turn a value remap into SQL. The type change comes first (lossless — every
     * integer has a string form), then one UPDATE per source value the operator
     * gives a meaning to; anything they leave alone keeps the target's neutral
     * value, which for these columns is what the old integer already widened to.
     *
     * @return string[]
     */
    private function planValueRemap(ColumnRemediation $r): array
    {
        if (!$this->interactive()) {
            $this->warn('    · needs an interactive choice per value; re-run without --assume-yes, '
                . 'or map it by hand. Skipping.');

            return [];
        }

        $choices = array_merge(['normal account (NULL)'], $r->meaningfulTargets);
        $updates = [];

        foreach ($r->distribution as $value => $count) {
            $answer = $this->choice(
                sprintf('    `%s` (%s row(s)) means', $value, number_format($count)),
                $choices,
                0,
            );

            if ($answer === $choices[0]) {
                $updates[] = sprintf(
                    'UPDATE `%s` SET `%s` = NULL WHERE `%s` = %s',
                    $r->table,
                    $r->column,
                    $r->column,
                    $this->quote((string) $value),
                );

                continue;
            }

            $updates[] = sprintf(
                'UPDATE `%s` SET `%s` = %s WHERE `%s` = %s',
                $r->table,
                $r->column,
                $this->quote($answer),
                $r->column,
                $this->quote((string) $value),
            );
        }

        // The column is widened to its text type first, so the UPDATEs above
        // compare against the values as strings.
        return array_merge(
            [sprintf('ALTER TABLE `%s` MODIFY COLUMN `%s` %s NULL', $r->table, $r->column, $r->targetType)],
            $updates,
        );
    }

    /**
     * Dry-run view of the guided `users.state` walk: the cohort it would act on
     * and the three whole-cohort choices offered, in place of the generic
     * per-value preview.
     */
    private function previewUserStateRemap(): void
    {
        $cohort = $this->userStateCohort();

        if ($cohort->isEmpty()) {
            $this->line('      No non-zero account states present — every account would be left normal, no prompt.');

            return;
        }

        $this->line(sprintf(
            '      %s account(s) carry a non-zero state (`0` is always kept as a normal account).',
            number_format($cohort->count()),
        ));
        $this->line('      The live run lists them (username + email, first 20) and offers one choice:');
        $this->line('        · unsuspend everyone (all → normal)');
        $this->line('        · mark them suspended (non-zero → suspended, 0 → normal)');
        $this->line('        · mark them pending under jGuard (enables jGuard + records pending entries)');
    }

    private function isUserStateRemap(ColumnRemediation $r): bool
    {
        return $r->kind === ColumnRemediation::KIND_VALUE_REMAP
            && $r->table === 'users'
            && $r->column === 'state';
    }

    /**
     * The accounts a `users.state` remap would act on: everyone whose fork state
     * is a non-zero code. `0` (and NULL) is always a normal, available account —
     * the one value this never touches — so the cohort is "everything else",
     * which for the forks this has seen is the old suspended/pending pool. Read
     * while the column is still an integer, before it is widened.
     *
     * @return \Illuminate\Support\Collection<int, \stdClass>
     */
    private function userStateCohort(): \Illuminate\Support\Collection
    {
        return DB::table('users')
            ->whereNotNull('state')
            ->where('state', '<>', 0)
            ->orderBy('id')
            ->get(['id', 'username', 'email']);
    }

    /**
     * The guided version of the `users.state` value remap. The generic per-value
     * walk asks what each integer means in the abstract; this knows the shape
     * these forks actually have — `0` is the live/admin account, every other code
     * is the old suspended/pending pool — and offers one decision over the whole
     * cohort instead. `0` (and NULL) is always released to a normal account.
     */
    private function remapUserState(SchemaAdoptService $service, ColumnRemediation $r): void
    {
        $cohort = $this->userStateCohort();
        $widen = sprintf('ALTER TABLE `%s` MODIFY COLUMN `%s` %s NULL', $r->table, $r->column, $r->targetType);

        // Nothing non-zero to decide: widen the column and release everyone. The
        // same end state as "unsuspend all", reached without a prompt.
        if ($cohort->isEmpty()) {
            try {
                $service->run($widen);
                $service->run(sprintf('UPDATE `%s` SET `%s` = NULL', $r->table, $r->column));
                $this->line('    ✔ no non-zero account states; every account left normal.');
            } catch (\Throwable $e) {
                $this->warn('    ! could not apply: ' . $e->getMessage());
            }

            return;
        }

        if (!$this->interactive()) {
            $this->warn('    · needs an interactive choice; re-run without --assume-yes, or map it by hand. Skipping.');

            return;
        }

        // Show who is in the cohort so the decision is made against real accounts,
        // not just a count. Capped so a large pool does not scroll the choice
        // itself off the screen.
        $this->line('');
        $this->line(sprintf('    %s account(s) carry a non-zero state (the old suspended/pending pool):', number_format($cohort->count())));
        foreach ($cohort->take(20) as $row) {
            $this->line(sprintf('      · %s <%s>', $row->username, $row->email));
        }
        if ($cohort->count() > 20) {
            $this->line(sprintf('      … and %s more not shown', number_format($cohort->count() - 20)));
        }
        $this->line('');

        $options = [
            'unsuspend' => 'Unsuspend everyone — set every account to normal (NULL)',
            'suspend' => sprintf('Mark those %s suspended; everyone else normal', number_format($cohort->count())),
            'pending' => sprintf('Mark those %s pending under jGuard; everyone else normal', number_format($cohort->count())),
        ];

        $answer = $this->choice('    What should happen to these accounts?', array_values($options), 0);
        $decision = (string) array_search($answer, $options, true);

        try {
            // Widen first: the UPDATEs below compare the state as text.
            $service->run($widen);

            if ($decision === 'unsuspend') {
                $service->run(sprintf('UPDATE `%s` SET `%s` = NULL', $r->table, $r->column));
                $this->line('    ✔ every account set to normal.');

                return;
            }

            $label = $decision === 'suspend' ? 'suspended' : 'pending';

            // Non-zero → the chosen label; the always-available `0` → normal.
            $service->run(sprintf(
                "UPDATE `%s` SET `%s` = %s WHERE `%s` <> '0' AND `%s` IS NOT NULL",
                $r->table,
                $r->column,
                $this->quote($label),
                $r->column,
                $r->column,
            ));
            $service->run(sprintf("UPDATE `%s` SET `%s` = NULL WHERE `%s` = '0'", $r->table, $r->column, $r->column));

            $this->line(sprintf('    ✔ %s account(s) marked %s; the rest left normal.', number_format($cohort->count()), $label));

            if ($decision === 'pending') {
                $this->holdCohortUnderJGuard($cohort);
            }
        } catch (\Throwable $e) {
            $this->warn('    ! could not apply: ' . $e->getMessage());
        }
    }

    /**
     * Make the pending state actually hold. The login flow only stops a pending
     * user while a matching pending `jguard_delay` row exists — with none it
     * reads the state as stale and releases the account. So enable jGuard and
     * record a manual-approval entry for each cohort member that lacks one.
     *
     * @param \Illuminate\Support\Collection<int, \stdClass> $cohort
     */
    private function holdCohortUnderJGuard(\Illuminate\Support\Collection $cohort): void
    {
        if (!config('modules.auth.jguard.enabled')) {
            Setting::set('settings::modules:auth:jguard:enabled', 'true');
            $this->line('    ✔ jGuard enabled so the pending accounts are held for approval.');
        }

        $ids = $cohort->pluck('id');
        $existing = DB::table('jguard_delay')
            ->whereIn('user_id', $ids)
            ->where('status', JGuardEntry::STATUS_PENDING)
            ->pluck('user_id')
            ->all();

        $now = now();
        $rows = $ids
            ->reject(fn ($id) => in_array($id, $existing, true))
            ->map(fn ($id) => [
                'user_id' => $id,
                'status' => JGuardEntry::STATUS_PENDING,
                'approval_mode' => JGuardEntry::MODE_MANUAL,
                'expires_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ])
            ->values()
            ->all();

        if ($rows !== []) {
            DB::table('jguard_delay')->insert($rows);
        }

        $this->line(sprintf(
            '    ✔ %s jGuard pending entr%s recorded; approve them in the panel to release each account.',
            number_format(count($rows)),
            count($rows) === 1 ? 'y' : 'ies',
        ));
    }

    /**
     * Turn a NULL fill into a single UPDATE. The column is made NOT NULL
     * afterwards by the ordinary schema plan, once these rows no longer hold
     * NULL. Under --assume-yes the proposed fill is used when there is one, and
     * the decision is deferred when there is not.
     *
     * @return string[]
     */
    private function planNullFill(ColumnRemediation $r): array
    {
        $fill = $r->proposedFill;

        if ($this->interactive()) {
            $answer = $this->ask(
                sprintf('    Fill the %s NULL row(s) with (blank keeps the default)', number_format($r->nullCount)),
                $fill,
            );
            $fill = $answer === null || $answer === '' ? $fill : $answer;
        }

        if ($fill === null) {
            $this->warn('    · no fill value and no default; supply one interactively or by hand. Skipping.');

            return [];
        }

        return [sprintf(
            'UPDATE `%s` SET `%s` = %s WHERE `%s` IS NULL',
            $r->table,
            $r->column,
            $this->quote($fill),
            $r->column,
        )];
    }

    private function interactive(): bool
    {
        return $this->input->isInteractive() && !$this->option('assume-yes');
    }

    private function quote(string $value): string
    {
        return DB::connection()->getPdo()->quote($value);
    }

    private function printPreamble(string $database, bool $adopted): void
    {
        $this->line('');
        $this->warn('  ┌───────────────────────────────────────────────────────────────────┐');
        $this->warn('  │  SCHEMA ADOPTION — EXPERIMENTAL                                    │');
        $this->warn('  └───────────────────────────────────────────────────────────────────┘');
        $this->line('');

        // An adopted install gets the status, not the pitch: the explanation of
        // what this command is for only helps someone who has not run it yet.
        if ($adopted) {
            $this->line("  Target database: {$database}");
            $this->line('');

            return;
        }

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
     * @param ColumnRemediation[] $remediations
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
        array $remediations,
        array $unrepairable,
        array $tolerated,
        array $extraTables,
        array $unknownMigrations,
        array $historyGap,
        array $columnOrderTables,
        array $legacyChain,
        array $currentChain,
        bool $adopted = false,
    ): void {
        $this->line('');

        // An adopted install has no legacy rows left — they were deleted on the
        // way through, not skipped — so every observation about the old chain
        // reads as an accusation of a state it is not in. Under --force the
        // schema plan is the only part that still means anything.
        if (!$adopted && $historyGap !== []) {
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

        if ($remediations !== []) {
            $this->reportRemediations($remediations);
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

        if ($adopted) {
            $this->line('Migration history: already the consolidated chain — left as it is.');
        } else {
            $this->line(sprintf(
                'Migration history: up to %d old row(s) will be replaced with the %d consolidated migrations.',
                count($legacyChain) - count($historyGap),
                count($currentChain),
            ));
        }

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
        $this->line('No row data is written by this command, other than the migrations table itself');
        $this->line('— except where a line above is marked `!`, which flags exactly the cases where');
        $this->line('existing rows are touched. Rows are counted, and checked against the range of a');
        $this->line('column whose type is changing, but never read out or copied anywhere.');
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
        $path = $this->archivePrefix() . date('Ymd-His') . '.json';

        @file_put_contents($path, json_encode($rows, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        if (is_readable($path)) {
            $this->line("  Previous migration history archived to {$path}");
        }
    }
}
