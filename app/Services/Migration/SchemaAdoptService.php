<?php

namespace Everest\Services\Migration;

use Illuminate\Database\Connection;

/**
 * Moves an existing install from the pre-rebuild migration chain onto the
 * consolidated one (see docs/database-rebuild/, D8).
 *
 * The two chains produce the same 80 tables and the same 881 columns, so this is
 * not a data migration. What differs is bookkeeping — the `migrations` table
 * lists 327 files that no longer exist — plus a short tail of index and
 * constraint names that still carry historical table names, and two tables the
 * rebuild dropped. This reconciles all three.
 *
 * Nothing here rewrites row data. The only DML is on the `migrations` table.
 */
class SchemaAdoptService
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * Reasons the install cannot be adopted, checked before anything is written.
     *
     * There is only one left. Being behind the old chain used to be a blocker,
     * on the assumption that an install was either fully migrated or not this
     * panel at all. Installs that tracked the development branch are neither:
     * they sit at whatever point they last pulled, so any two are missing a
     * different subset of the same changes. The live schema is compared against
     * the baseline and whatever is missing is built, which covers all of those
     * cases without needing to know which one this is.
     *
     * @return string[]
     */
    public function blockers(): array
    {
        if ($this->appliedMigrations() === []) {
            return ['This database has no migration history at all. `p:migrate:adopt` upgrades an existing install; a fresh install should just run `php artisan migrate`.'];
        }

        return [];
    }

    /**
     * How far behind the old chain this install is. Informational: the schema,
     * not the bookkeeping, decides what gets built.
     *
     * @param string[] $legacyChain
     *
     * @return string[] the migrations that never ran here
     */
    public function historyGap(array $legacyChain): array
    {
        return array_values(array_diff($legacyChain, $this->appliedMigrations()));
    }

    /**
     * True when the migrations table already lists the consolidated chain, so
     * running this again would be a no-op. Checked so a second run — or an
     * installer that always calls it — is harmless rather than destructive.
     *
     * @param string[] $currentChain
     */
    public function alreadyAdopted(array $currentChain): bool
    {
        return array_diff($currentChain, $this->appliedMigrations()) === [];
    }

    /**
     * Migration rows that no longer correspond to any file the panel ships.
     * Usually harmless leftovers from removed features; reported so a surprising
     * one is seen rather than silently discarded.
     *
     * @param string[] $legacyChain
     * @param string[] $currentChain
     *
     * @return string[]
     */
    public function unknownMigrations(array $legacyChain, array $currentChain, array $extensionPrefixes = ['ext_', 'create_ext_']): array
    {
        $unknown = array_diff($this->appliedMigrations(), $legacyChain, $currentChain);

        return array_values(array_filter($unknown, function (string $name) {
            // Extension migrations are managed separately and keep their rows.
            return !str_contains($name, '_ext_');
        }));
    }

    /**
     * @param string[] $tables
     *
     * @return array<string, int> table => row count, for tables that are not empty
     */
    public function nonEmpty(array $tables): array
    {
        $counts = [];

        foreach ($tables as $table) {
            $count = (int) $this->connection->table($table)->count();

            if ($count > 0) {
                $counts[$table] = $count;
            }
        }

        return $counts;
    }

    /**
     * Apply the reconciling statements, a phase at a time.
     *
     * Two things shape this. First, DDL does not roll back on MySQL or MariaDB,
     * so there is no pretence of a transaction — instead every change is
     * independent and the whole command is idempotent, recomputing what is left
     * from the live schema.
     *
     * Second, applying a change routinely changes what the remaining ones need
     * to do. Adding a column makes an index over it possible; on MariaDB,
     * rebuilding a foreign key takes its identically-named backing index with
     * it, so a rename planned against the original schema would then be
     * renaming something that no longer exists. So the plan is recomputed
     * between phases rather than being fixed up front. $replan is what does
     * that: it returns the filtered plan against the schema as it stands now.
     *
     * A failing change does not stop the run either. Anything that cannot be
     * applied is recorded and the rest are still attempted, because the whole
     * point is to get as close to the shipped schema as this install allows and
     * then say plainly what is left.
     *
     * @return array{applied: SchemaChange[], failed: array<array{change: SchemaChange, statement: string, error: string}>}
     */
    /**
     * Run one statement outside the phased plan — the data fixes a remediation
     * produces, which have to land before the columns they belong to are
     * altered. Unlike a plan change these are not swallowed on failure: a fill
     * or remap that cannot be written is a reason to stop, not to press on.
     */
    public function run(string $statement): void
    {
        $this->connection->statement($statement);
    }

    public function applyPlan(callable $replan, ?callable $onApplied = null): array
    {
        $applied = [];
        $failed = [];

        foreach (SchemaChange::phases() as $phase) {
            $changes = array_values(array_filter($replan(), fn (SchemaChange $c) => $c->phase() === $phase));

            foreach ($changes as $change) {
                try {
                    foreach ($change->statements as $statement) {
                        $this->connection->statement($statement);
                    }
                } catch (\Throwable $e) {
                    $failed[] = [
                        'change' => $change,
                        'statement' => $statement ?? '',
                        'error' => $this->concise($e->getMessage()),
                    ];

                    continue;
                }

                $applied[] = $change;

                if ($onApplied !== null) {
                    $onApplied($change);
                }
            }
        }

        return ['applied' => $applied, 'failed' => $failed];
    }

    /**
     * Laravel appends the connection, host and full SQL to every query error.
     * All three are already on screen next to the message, so drop them.
     */
    private function concise(string $message): string
    {
        return trim((string) preg_replace('/ \(Connection: .*$/s', '', $message));
    }

    /**
     * Replace the recorded migration history with the consolidated chain, in one
     * transaction. Run last, so an interrupted upgrade leaves the install on its
     * old bookkeeping and re-runnable rather than half-claimed.
     *
     * @param string[] $legacyChain
     * @param string[] $currentChain
     *
     * @return array{removed: int, inserted: int, archived: array}
     */
    public function rewriteMigrationHistory(array $legacyChain, array $currentChain): array
    {
        $archived = $this->connection->table('migrations')->orderBy('id')->get()->toArray();

        // Anything not part of the old chain — extension migrations especially —
        // keeps its row and its batch number.
        $retained = array_values(array_filter(
            $archived,
            fn ($row) => !in_array($row->migration, $legacyChain, true)
        ));

        $this->connection->transaction(function () use ($legacyChain, $currentChain, &$inserted) {
            $this->connection->table('migrations')
                ->whereIn('migration', $legacyChain)
                ->delete();

            $batch = (int) ($this->connection->table('migrations')->max('batch') ?? 0) + 1;

            $rows = array_map(
                fn (string $name) => ['migration' => $name, 'batch' => $batch],
                array_values(array_diff($currentChain, $this->appliedMigrations())),
            );

            if ($rows !== []) {
                $this->connection->table('migrations')->insert($rows);
            }

            $inserted = count($rows);
        });

        return [
            'removed' => count($archived) - count($retained),
            'inserted' => $inserted,
            'archived' => $archived,
        ];
    }

    /** @return string[] */
    private function appliedMigrations(): array
    {
        if (!$this->connection->getSchemaBuilder()->hasTable('migrations')) {
            return [];
        }

        return $this->connection->table('migrations')->pluck('migration')->all();
    }
}
