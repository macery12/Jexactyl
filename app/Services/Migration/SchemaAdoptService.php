<?php

namespace Everest\Services\Migration;

use RuntimeException;
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
     * @param string[] $legacyChain
     * @param string[] $currentChain
     *
     * @return string[]
     */
    public function blockers(array $legacyChain, array $currentChain): array
    {
        $blockers = [];
        $applied = $this->appliedMigrations();

        if ($applied === []) {
            $blockers[] = 'This database has no migration history at all. `p:migrate:adopt` upgrades an existing install; a fresh install should just run `php artisan migrate`.';

            return $blockers;
        }

        $missing = array_diff($legacyChain, $applied);

        if ($missing !== []) {
            $blockers[] = sprintf(
                "This install is behind the old migration chain — %d of %d migrations were never applied, the oldest being `%s`.\n"
                    . 'Check out the last release before the schema rebuild, run `php artisan migrate`, then come back to this version and run this command.',
                count($missing),
                count($legacyChain),
                reset($missing),
            );
        }

        return $blockers;
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
     * Apply the reconciling statements.
     *
     * DDL does not roll back on MySQL or MariaDB, so this deliberately does not
     * pretend to be transactional. Instead each change is independent and the
     * whole command is idempotent: the plan is recomputed from the live schema
     * every run, so a failure part-way through is resumed by running it again.
     * Changes are ordered cosmetic-first and destructive-last, so the earliest
     * failure is also the cheapest one to be interrupted by.
     *
     * @param SchemaChange[] $changes
     *
     * @return SchemaChange[] the changes that were applied
     */
    public function applyChanges(array $changes): array
    {
        $applied = [];

        foreach ($this->ordered($changes) as $change) {
            foreach ($change->statements as $statement) {
                try {
                    $this->connection->statement($statement);
                } catch (\Throwable $e) {
                    throw new RuntimeException(sprintf(
                        "Failed while applying: %s\n  Statement: %s\n  %s\n\n"
                            . '%d change(s) were applied before this one and are already in place. '
                            . 'This command is safe to re-run once the cause is fixed — it recomputes what is left from the live schema.',
                        $change->description,
                        $statement,
                        $e->getMessage(),
                        count($applied),
                    ), 0, $e);
                }
            }

            $applied[] = $change;
        }

        return $applied;
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

    /**
     * Cosmetic renames first (cheap, no behaviour change), then index rebuilds,
     * then anything destructive.
     *
     * @param SchemaChange[] $changes
     *
     * @return SchemaChange[]
     */
    private function ordered(array $changes): array
    {
        $weight = [
            SchemaChange::KIND_REBUILD_FOREIGN_KEY => 0,
            SchemaChange::KIND_RENAME_INDEX => 1,
            SchemaChange::KIND_CREATE_INDEX => 2,
            SchemaChange::KIND_REBUILD_INDEX => 3,
            SchemaChange::KIND_DROP_INDEX => 4,
            SchemaChange::KIND_DROP_TABLE => 5,
        ];

        usort($changes, fn (SchemaChange $a, SchemaChange $b) => ($weight[$a->kind] ?? 9) <=> ($weight[$b->kind] ?? 9));

        return $changes;
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
