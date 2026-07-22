<?php

namespace Everest\Services\Migration;

use Illuminate\Database\Connection;

/**
 * Copies data out of another Pterodactyl-family panel and into this one.
 *
 * The import is schema-driven rather than a fixed column list: for each table it
 * compares the source and target columns and copies the intersection, applying
 * the profile's renames, transforms and defaults. Columns the source has and the
 * target does not are reported as data left behind; target columns that are NOT
 * NULL, have no database default, and that nothing in the profile supplies stop
 * the import outright. That way an unexpected schema — a source panel on a
 * version the profile was not built against — surfaces as a refusal to run
 * instead of silently importing partial rows.
 *
 * IDs and UUIDs are preserved. Wings identifies servers by UUID and stores their
 * data directories under it, so renumbering would orphan every server on disk.
 * Preserving IDs is also why the target tables must be empty.
 */
class PanelImportService
{
    private const INSERT_CHUNK = 500;
    private const READ_CHUNK = 1000;

    public function __construct(private readonly Connection $target)
    {
    }

    /**
     * Verify the import can run, without writing anything.
     *
     * @param string[] $groups
     *
     * @throws \RuntimeException if the import must not proceed
     */
    public function preflight(ImportProfile $profile, Connection $source, ImportContext $context, array $groups): ImportSummary
    {
        $summary = new ImportSummary();
        $plans = $this->plansFor($profile, $groups);

        $sourceTables = $this->tableNames($source);
        $targetTables = $this->tableNames($this->target);

        $nonEmpty = [];
        foreach ($plans as $plan) {
            if (!in_array($plan->sourceTable(), $sourceTables, true)) {
                continue;
            }

            if (!in_array($plan->table, $targetTables, true)) {
                throw new \RuntimeException("Target table `{$plan->table}` does not exist. Run `php artisan migrate` before importing.");
            }

            if ($this->target->table($plan->table)->exists()) {
                $nonEmpty[] = $plan->table;
            }
        }

        if ($nonEmpty !== []) {
            throw new \RuntimeException('Refusing to import: the following tables already contain data — ' . implode(', ', $nonEmpty) . ".\nImports preserve the source panel's IDs, so they can only run into a freshly migrated, empty database.");
        }

        $this->probeEncryption($profile, $source, $context, $sourceTables);

        foreach ($profile->excludedTables() as $table => $reason) {
            if (!in_array($table, $sourceTables, true)) {
                continue;
            }

            $rows = $source->table($table)->count();
            if ($rows > 0) {
                $summary->skipped($table, "{$reason} ({$rows} rows)");
            }
        }

        foreach ($profile->warnings() as $warning) {
            $summary->warn($warning);
        }

        return $summary;
    }

    /**
     * Run the import. With $dryRun the work happens inside a transaction that is
     * rolled back, so constraint and mapping failures surface for real without
     * leaving anything behind.
     *
     * @param string[] $groups
     */
    public function import(ImportProfile $profile, Connection $source, ImportContext $context, array $groups, bool $dryRun = false): ImportSummary
    {
        $summary = $this->preflight($profile, $source, $context, $groups);
        $plans = $this->plansFor($profile, $groups);
        $sourceTables = $this->tableNames($source);

        // servers.allocation_id and allocations.server_id reference each other,
        // so no insertion order satisfies both. The source snapshot is already
        // internally consistent, so checks are suspended for the copy and the
        // integrity of the result is verified afterwards.
        $this->target->statement('SET FOREIGN_KEY_CHECKS=0');

        try {
            $this->target->beginTransaction();

            foreach ($plans as $plan) {
                if (!in_array($plan->sourceTable(), $sourceTables, true)) {
                    $summary->skipped($plan->table, 'not present in the source panel');
                    continue;
                }

                $this->copyTable($plan, $source, $context, $summary);
            }

            $profile->afterImport($source, $this->target, $summary);
            $this->verifyReferentialIntegrity(array_keys($summary->copied), $summary);

            if ($dryRun) {
                $this->target->rollBack();
            } else {
                $this->target->commit();
            }
        } catch (\Throwable $e) {
            if ($this->target->transactionLevel() > 0) {
                $this->target->rollBack();
            }

            throw $e;
        } finally {
            $this->target->statement('SET FOREIGN_KEY_CHECKS=1');
        }

        return $summary;
    }

    /**
     * Foreign key checks are off while copying, so prove the result is sound
     * before committing: every foreign key on an imported table must resolve.
     * A source panel with pre-existing orphan rows would otherwise import a
     * database this panel cannot enforce its own constraints on.
     *
     * @param string[] $tables
     */
    private function verifyReferentialIntegrity(array $tables, ImportSummary $summary): void
    {
        if ($tables === []) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($tables), '?'));
        $constraints = $this->target->select(
            "SELECT constraint_name, table_name, column_name, referenced_table_name, referenced_column_name
             FROM information_schema.key_column_usage
             WHERE table_schema = ? AND referenced_table_name IS NOT NULL AND table_name IN ({$placeholders})
             ORDER BY table_name, constraint_name, ordinal_position",
            array_merge([$this->target->getDatabaseName()], $tables)
        );

        // Group by constraint so composite keys are checked as a unit.
        $grouped = [];
        foreach ($constraints as $row) {
            $row = array_change_key_case((array) $row);
            $grouped[$row['table_name'] . '.' . $row['constraint_name']][] = $row;
        }

        $violations = [];
        foreach ($grouped as $columns) {
            $child = $columns[0]['table_name'];
            $parent = $columns[0]['referenced_table_name'];

            $on = [];
            $notNull = [];
            foreach ($columns as $column) {
                $on[] = "c.`{$column['column_name']}` = p.`{$column['referenced_column_name']}`";
                $notNull[] = "c.`{$column['column_name']}` IS NOT NULL";
            }

            $orphans = $this->target->selectOne(sprintf(
                'SELECT COUNT(*) AS orphans FROM `%s` c LEFT JOIN `%s` p ON %s WHERE %s AND p.`%s` IS NULL',
                $child,
                $parent,
                implode(' AND ', $on),
                implode(' AND ', $notNull),
                $columns[0]['referenced_column_name']
            ));

            $count = (int) ((array) array_change_key_case((array) $orphans))['orphans'];
            if ($count > 0) {
                $violations[] = "{$child}: {$count} row(s) reference a `{$parent}` row that does not exist";
            }
        }

        if ($violations !== []) {
            throw new \RuntimeException("The imported data does not hold together — it references rows that do not exist:\n  - " . implode("\n  - ", $violations) . "\nThis usually means the source database already had orphaned rows. Nothing was written.");
        }

        $summary->note(sprintf('Verified %d foreign key relationships across the imported tables.', count($grouped)));
    }

    private function copyTable(TablePlan $plan, Connection $source, ImportContext $context, ImportSummary $summary): void
    {
        $sourceTable = $plan->sourceTable();
        $sourceColumns = $this->columns($source, $sourceTable);
        $targetColumns = $this->columns($this->target, $plan->table);

        // source column => target column, for everything that has a home
        $mapping = [];
        foreach (array_keys($sourceColumns) as $column) {
            $target = $plan->targetColumn($column);

            if ($target === null) {
                if (isset($plan->converted[$column])) {
                    $summary->note("{$sourceTable}.{$column}: {$plan->converted[$column]}");
                } else {
                    $summary->dropColumn(
                        $sourceTable,
                        $column,
                        $source->table($sourceTable)->whereNotNull($column)->count(),
                        $plan->drops[$column]
                    );
                }

                continue;
            }

            if (!array_key_exists($target, $targetColumns)) {
                $summary->dropColumn(
                    $sourceTable,
                    $column,
                    $source->table($sourceTable)->whereNotNull($column)->count(),
                    'no equivalent column in this panel'
                );
                continue;
            }

            $mapping[$column] = $target;
        }

        $this->assertRequiredColumnsSatisfied($plan, $targetColumns, $mapping);

        $written = 0;
        $buffer = [];

        $this->eachSourceRow($source, $sourceTable, $sourceColumns, function (array $row) use (
            $plan,
            $mapping,
            $context,
            &$buffer,
            &$written
        ) {
            if ($plan->filter !== null && !($plan->filter)($row)) {
                return;
            }

            $buffer[] = $this->buildRow($plan, $mapping, $row, $context);

            if (count($buffer) >= self::INSERT_CHUNK) {
                $this->target->table($plan->table)->insert($buffer);
                $written += count($buffer);
                $buffer = [];
            }
        });

        if ($buffer !== []) {
            $this->target->table($plan->table)->insert($buffer);
            $written += count($buffer);
        }

        $summary->copied($plan->table, $written);
    }

    /**
     * @param array<string, string> $mapping source column => target column
     */
    private function buildRow(TablePlan $plan, array $mapping, array $row, ImportContext $context): array
    {
        $out = [];

        foreach ($mapping as $sourceColumn => $targetColumn) {
            $value = $row[$sourceColumn];

            if (isset($plan->transforms[$targetColumn])) {
                $value = ($plan->transforms[$targetColumn])($value, $row, $context);
            }

            $out[$targetColumn] = $value;
        }

        foreach ($plan->defaults as $targetColumn => $default) {
            if (array_key_exists($targetColumn, $out)) {
                continue;
            }

            $out[$targetColumn] = $default instanceof \Closure ? $default($row, $context) : $default;
        }

        return $out;
    }

    /**
     * A target column that cannot be null, has no database default, and that
     * neither the mapping nor the profile supplies means the profile does not
     * match this source schema. Stop rather than write a row the panel cannot
     * use.
     */
    private function assertRequiredColumnsSatisfied(TablePlan $plan, array $targetColumns, array $mapping): void
    {
        $supplied = array_merge(array_values($mapping), array_keys($plan->defaults));
        $missing = [];

        foreach ($targetColumns as $name => $meta) {
            if (in_array($name, $supplied, true)) {
                continue;
            }

            if ($meta['nullable'] || $meta['default'] !== null || $meta['auto_increment'] || $meta['generated']) {
                continue;
            }

            $missing[] = $name;
        }

        if ($missing !== []) {
            throw new \RuntimeException("Cannot import `{$plan->table}`: this panel requires " . implode(', ', $missing) . ', and the source schema provides no value for ' . (count($missing) === 1 ? 'it' : 'them') . ".\n" . 'This usually means the source panel is on a version this importer was not built against.');
        }
    }

    /**
     * Stream a source table. Tables with a single-column primary key are read in
     * keyset chunks; the rest are pivot tables small enough to read whole.
     */
    private function eachSourceRow(Connection $source, string $table, array $columns, \Closure $callback): void
    {
        $key = $this->singleColumnPrimaryKey($source, $table);

        if ($key === null) {
            foreach ($source->table($table)->get() as $row) {
                $callback((array) $row);
            }

            return;
        }

        $source->table($table)->orderBy($key)->chunkById(self::READ_CHUNK, function ($rows) use ($callback) {
            foreach ($rows as $row) {
                $callback((array) $row);
            }
        }, $key);
    }

    private function probeEncryption(ImportProfile $profile, Connection $source, ImportContext $context, array $sourceTables): void
    {
        foreach ($profile->encryptedColumns() as $table => $columns) {
            if (!in_array($table, $sourceTables, true)) {
                continue;
            }

            foreach ($columns as $column) {
                $sample = $source->table($table)
                    ->whereNotNull($column)
                    ->where($column, '!=', '')
                    ->value($column);

                if ($sample === null) {
                    continue;
                }

                if (!$context->canDecrypt($sample)) {
                    throw new \RuntimeException("Could not decrypt {$table}.{$column} with the supplied source APP_KEY.\nCheck the APP_KEY in the old panel's .env file — it must be the key that panel was\n" . 'using, or its node tokens and stored passwords cannot be re-encrypted for this panel.');
                }
            }
        }
    }

    /**
     * @return TablePlan[]
     */
    private function plansFor(ImportProfile $profile, array $groups): array
    {
        return array_values(array_filter(
            $profile->tables(),
            fn (TablePlan $plan) => in_array($plan->group, $groups, true)
        ));
    }

    /**
     * @return array<string, array{nullable: bool, default: ?string, auto_increment: bool, generated: bool}>
     */
    private function columns(Connection $connection, string $table): array
    {
        $rows = $connection->select(
            'SELECT column_name, is_nullable, column_default, extra
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?
             ORDER BY ordinal_position',
            [$connection->getDatabaseName(), $table]
        );

        $columns = [];
        foreach ($rows as $row) {
            $row = (array) array_change_key_case((array) $row);
            $extra = strtolower((string) $row['extra']);

            $columns[$row['column_name']] = [
                'nullable' => strtoupper((string) $row['is_nullable']) === 'YES',
                'default' => $row['column_default'],
                'auto_increment' => str_contains($extra, 'auto_increment'),
                'generated' => str_contains($extra, 'generated'),
            ];
        }

        return $columns;
    }

    private function singleColumnPrimaryKey(Connection $connection, string $table): ?string
    {
        $rows = $connection->select(
            "SELECT column_name FROM information_schema.statistics
             WHERE table_schema = ? AND table_name = ? AND index_name = 'PRIMARY'",
            [$connection->getDatabaseName(), $table]
        );

        if (count($rows) !== 1) {
            return null;
        }

        return ((array) array_change_key_case((array) $rows[0]))['column_name'];
    }

    /**
     * @return string[]
     */
    private function tableNames(Connection $connection): array
    {
        $rows = $connection->select(
            'SELECT table_name FROM information_schema.tables WHERE table_schema = ?',
            [$connection->getDatabaseName()]
        );

        return array_map(fn ($row) => ((array) array_change_key_case((array) $row))['table_name'], $rows);
    }
}
