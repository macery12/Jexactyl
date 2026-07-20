<?php

namespace Everest\Services\Migration;

use Illuminate\Database\Connection;

/**
 * Compares an existing install against the shipped schema baseline and works
 * out what it would take to make them identical.
 *
 * Indexes are matched by shape (columns + uniqueness) rather than by name, so
 * an install carrying index names from a historical table name is recognised as
 * "the right index, wrong label" instead of "missing index, plus a stranger".
 * That is what makes this safe to run against installs whose exact history is
 * unknown: the names are discovered, not assumed.
 */
class SchemaReconciler
{
    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * Differences that this tool will not attempt to fix. Any of these means the
     * install is not the schema the baseline describes, and the operator needs
     * to know rather than have it papered over.
     *
     * @return string[]
     */
    public function blockingDifferences(SchemaBaseline $baseline): array
    {
        $problems = [];
        $actualTables = $this->tables();

        foreach ($baseline->tableNames() as $table) {
            if ($table === 'migrations') {
                continue;
            }

            if (!in_array($table, $actualTables, true)) {
                $problems[] = "table `{$table}` is missing";

                continue;
            }

            $expected = $baseline->columns($table);
            $actual = $this->columns($table);

            foreach ($expected as $column => $definition) {
                if (!isset($actual[$column])) {
                    $problems[] = "`{$table}`.`{$column}` is missing";

                    continue;
                }

                foreach ($this->describeColumnDifferences($definition, $actual[$column]) as $difference) {
                    $problems[] = "`{$table}`.`{$column}`: {$difference}";
                }
            }

            foreach (array_diff(array_keys($actual), array_keys($expected)) as $column) {
                $problems[] = "`{$table}`.`{$column}` exists here but not in the shipped schema";
            }
        }

        return $problems;
    }

    /**
     * Tables whose columns are all present and correct but sit in a different
     * physical order than a fresh install — the signature of a column added by a
     * later ALTER rather than in the original CREATE.
     *
     * Nothing in the panel depends on column order, and correcting it would mean
     * rebuilding the table, so this is reported and left alone. It is worth
     * surfacing because it is the usual explanation for a `mysqldump` of an
     * upgraded install not matching one of a fresh install byte for byte.
     *
     * @return string[]
     */
    public function columnOrderDifferences(SchemaBaseline $baseline): array
    {
        $tables = [];
        $actualTables = $this->tables();

        foreach ($baseline->tableNames() as $table) {
            if ($table === 'migrations' || !in_array($table, $actualTables, true)) {
                continue;
            }

            $expected = array_keys($baseline->columns($table));
            $actual = array_keys($this->columns($table));

            if ($expected !== $actual && array_diff($expected, $actual) === [] && array_diff($actual, $expected) === []) {
                $tables[] = $table;
            }
        }

        return $tables;
    }

    /**
     * Tables this install has that the shipped schema does not. Extension tables
     * are excluded — they are managed by their own migrations and are none of
     * this command's business.
     *
     * @return string[]
     */
    public function extraTables(SchemaBaseline $baseline): array
    {
        return array_values(array_filter(
            $this->tables(),
            fn (string $table) => !$baseline->hasTable($table) && !str_starts_with($table, 'ext_')
        ));
    }

    /**
     * @param string[] $dropTables tables to remove, already confirmed empty
     *
     * @return SchemaChange[]
     */
    public function plan(SchemaBaseline $baseline, array $dropTables = []): array
    {
        $changes = [];
        $actualTables = $this->tables();

        foreach ($baseline->tableNames() as $table) {
            if ($table === 'migrations' || !in_array($table, $actualTables, true)) {
                continue;
            }

            $changes = array_merge(
                $changes,
                $this->planForeignKeys($baseline, $table),
                $this->planIndexes($baseline, $table),
            );
        }

        foreach ($dropTables as $table) {
            $changes[] = new SchemaChange(
                kind: SchemaChange::KIND_DROP_TABLE,
                table: $table,
                description: "drop `{$table}` — removed from this panel's schema",
                statements: ["DROP TABLE `{$table}`"],
                destructive: true,
            );
        }

        return $changes;
    }

    /**
     * Foreign keys are planned before indexes: a constraint holds a lock on its
     * backing index, so renaming that index while the old constraint still
     * points at it can fail. Rebuilding the constraint first frees the index.
     *
     * @return SchemaChange[]
     */
    private function planForeignKeys(SchemaBaseline $baseline, string $table): array
    {
        $expected = $baseline->foreignKeys($table);
        $actual = $this->foreignKeys($table);
        $changes = [];

        $matchedActual = [];

        foreach ($expected as $name => $definition) {
            $match = $this->findByShape($actual, $definition, $matchedActual, ['columns', 'refTable', 'refColumns', 'onDelete', 'onUpdate']);

            if ($match === null) {
                // A missing or reshaped FK is a structural difference, not a
                // naming one; blockingDifferences() has already reported the
                // column-level cause if there is one.
                continue;
            }

            $matchedActual[] = $match;

            if ($match === $name) {
                continue;
            }

            $changes[] = new SchemaChange(
                kind: SchemaChange::KIND_REBUILD_FOREIGN_KEY,
                table: $table,
                description: "`{$table}`: constraint `{$match}` → `{$name}` (historical name)",
                statements: [
                    "ALTER TABLE `{$table}` DROP FOREIGN KEY `{$match}`",
                    sprintf(
                        'ALTER TABLE `%s` ADD CONSTRAINT `%s` FOREIGN KEY (%s) REFERENCES `%s` (%s)%s%s',
                        $table,
                        $name,
                        $this->quoteList($definition['columns']),
                        $definition['refTable'],
                        $this->quoteList($definition['refColumns']),
                        $definition['onDelete'] ? ' ON DELETE ' . $definition['onDelete'] : '',
                        $definition['onUpdate'] ? ' ON UPDATE ' . $definition['onUpdate'] : '',
                    ),
                ],
            );
        }

        return $changes;
    }

    /** @return SchemaChange[] */
    private function planIndexes(SchemaBaseline $baseline, string $table): array
    {
        $expected = $baseline->indexes($table);
        $actual = $this->indexes($table);
        $changes = [];

        // Indexes that back a foreign key cannot be dropped while it exists, and
        // dropping one that is merely redundant is never worth a failed upgrade.
        $fkBacked = $this->foreignKeyBackingIndexes($table);

        $matchedActual = [];

        foreach ($expected as $name => $definition) {
            $match = $this->findByShape($actual, $definition, $matchedActual, ['columns', 'unique']);

            if ($match !== null) {
                $matchedActual[] = $match;

                if ($match !== $name) {
                    $changes[] = new SchemaChange(
                        kind: SchemaChange::KIND_RENAME_INDEX,
                        table: $table,
                        description: "`{$table}`: index `{$match}` → `{$name}` (historical name)",
                        statements: ["ALTER TABLE `{$table}` RENAME INDEX `{$match}` TO `{$name}`"],
                    );
                }

                continue;
            }

            // Nothing here has the right shape. If the name is taken, the index
            // under it is the wrong one and gets rebuilt; otherwise it is simply
            // absent.
            if (isset($actual[$name])) {
                $matchedActual[] = $name;

                $changes[] = new SchemaChange(
                    kind: SchemaChange::KIND_REBUILD_INDEX,
                    table: $table,
                    description: sprintf(
                        '`%s`: index `%s` covers (%s), should cover (%s) — rebuilt',
                        $table,
                        $name,
                        implode(', ', $actual[$name]['columns']),
                        implode(', ', $definition['columns']),
                    ),
                    statements: [
                        "ALTER TABLE `{$table}` DROP INDEX `{$name}`",
                        $this->createIndexStatement($table, $name, $definition),
                    ],
                );

                continue;
            }

            $changes[] = new SchemaChange(
                kind: SchemaChange::KIND_CREATE_INDEX,
                table: $table,
                description: sprintf('`%s`: add missing index `%s` (%s)', $table, $name, implode(', ', $definition['columns'])),
                statements: [$this->createIndexStatement($table, $name, $definition)],
            );
        }

        foreach ($actual as $name => $definition) {
            if (in_array($name, $matchedActual, true) || isset($expected[$name]) || in_array($name, $fkBacked, true)) {
                continue;
            }

            $changes[] = new SchemaChange(
                kind: SchemaChange::KIND_DROP_INDEX,
                table: $table,
                description: sprintf(
                    '`%s`: drop redundant index `%s` (%s) — not in the shipped schema',
                    $table,
                    $name,
                    implode(', ', $definition['columns']),
                ),
                statements: ["ALTER TABLE `{$table}` DROP INDEX `{$name}`"],
                destructive: true,
            );
        }

        return $changes;
    }

    /**
     * Find an entry whose shape matches, ignoring its name and skipping any
     * already claimed by an earlier match.
     *
     * @param array<string, array> $candidates
     * @param string[]             $claimed
     * @param string[]             $keys
     */
    private function findByShape(array $candidates, array $wanted, array $claimed, array $keys): ?string
    {
        foreach ($candidates as $name => $candidate) {
            if (in_array($name, $claimed, true)) {
                continue;
            }

            foreach ($keys as $key) {
                if (($candidate[$key] ?? null) !== ($wanted[$key] ?? null)) {
                    continue 2;
                }
            }

            return $name;
        }

        return null;
    }

    private function createIndexStatement(string $table, string $name, array $definition): string
    {
        return sprintf(
            'ALTER TABLE `%s` ADD %sINDEX `%s` (%s)',
            $table,
            $definition['unique'] ? 'UNIQUE ' : '',
            $name,
            $this->quoteList($definition['columns']),
        );
    }

    /** @param string[] $columns */
    private function quoteList(array $columns): string
    {
        return implode(', ', array_map(fn (string $c) => "`{$c}`", $columns));
    }

    /** @return string[] */
    private function tables(): array
    {
        return array_map(
            fn ($row) => $row->TABLE_NAME,
            $this->connection->select(
                'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = "BASE TABLE" ORDER BY TABLE_NAME'
            )
        );
    }

    /**
     * The same structured facts SchemaBaseline extracts from the dump, so the
     * two can be compared field by field.
     *
     * @return array<string, array{type: string, nullable: bool, default: ?string, extra: string, collation: ?string, comment: string}>
     */
    private function columns(string $table): array
    {
        $rows = $this->connection->select(
            'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME, COLUMN_COMMENT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
             ORDER BY ORDINAL_POSITION',
            [$table]
        );

        $columns = [];

        foreach ($rows as $row) {
            $columns[$row->COLUMN_NAME] = [
                'type' => $row->COLUMN_TYPE,
                'nullable' => $row->IS_NULLABLE === 'YES',
                // COLUMN_DEFAULT is PHP null when there is no default at all,
                // and the four-character string "NULL" when the default is NULL.
                'default' => $row->COLUMN_DEFAULT === null
                    ? null
                    : preg_replace("/^'\\d{4}-\\d{2}-\\d{2}'$/", "'<migrate-date>'", (string) $row->COLUMN_DEFAULT),
                'extra' => strtolower((string) $row->EXTRA),
                'collation' => $row->COLLATION_NAME,
                'comment' => (string) $row->COLUMN_COMMENT,
            ];
        }

        return $columns;
    }

    /**
     * @return string[] one plain-language line per field that differs
     */
    private function describeColumnDifferences(array $expected, array $actual): array
    {
        $labels = [
            'type' => 'type',
            'nullable' => 'nullability',
            'default' => 'default',
            'extra' => 'attributes',
            'collation' => 'collation',
            'comment' => 'comment',
        ];

        $differences = [];

        foreach ($labels as $field => $label) {
            if (($expected[$field] ?? null) === ($actual[$field] ?? null)) {
                continue;
            }

            $differences[] = sprintf(
                '%s is %s, expected %s',
                $label,
                $this->describeValue($actual[$field] ?? null),
                $this->describeValue($expected[$field] ?? null),
            );
        }

        return $differences;
    }

    private function describeValue(mixed $value): string
    {
        return match (true) {
            $value === null => 'unset',
            $value === true => 'nullable',
            $value === false => 'NOT NULL',
            $value === '' => 'none',
            default => "`{$value}`",
        };
    }

    /** @return array<string, array{columns: string[], unique: bool}> */
    private function indexes(string $table): array
    {
        $rows = $this->connection->select(
            'SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME != "PRIMARY"
             ORDER BY INDEX_NAME, SEQ_IN_INDEX',
            [$table]
        );

        $indexes = [];

        foreach ($rows as $row) {
            $indexes[$row->INDEX_NAME]['columns'][] = $row->COLUMN_NAME;
            $indexes[$row->INDEX_NAME]['unique'] = (int) $row->NON_UNIQUE === 0;
        }

        return $indexes;
    }

    /** @return array<string, array> */
    private function foreignKeys(string $table): array
    {
        $rows = $this->connection->select(
            'SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
                    r.DELETE_RULE, r.UPDATE_RULE
             FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
             WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
            [$table]
        );

        $keys = [];

        foreach ($rows as $row) {
            $name = $row->CONSTRAINT_NAME;
            $keys[$name]['columns'][] = $row->COLUMN_NAME;
            $keys[$name]['refColumns'][] = $row->REFERENCED_COLUMN_NAME;
            $keys[$name]['refTable'] = $row->REFERENCED_TABLE_NAME;
            // mysqldump omits the clause entirely for the default RESTRICT/NO ACTION.
            $keys[$name]['onDelete'] = in_array($row->DELETE_RULE, ['RESTRICT', 'NO ACTION'], true) ? null : $row->DELETE_RULE;
            $keys[$name]['onUpdate'] = in_array($row->UPDATE_RULE, ['RESTRICT', 'NO ACTION'], true) ? null : $row->UPDATE_RULE;
        }

        return $keys;
    }

    /** @return string[] */
    private function foreignKeyBackingIndexes(string $table): array
    {
        $names = [];

        foreach ($this->foreignKeys($table) as $key) {
            foreach ($this->indexes($table) as $indexName => $index) {
                // InnoDB accepts any index whose leading columns cover the key.
                if (array_slice($index['columns'], 0, count($key['columns'])) === $key['columns']) {
                    $names[] = $indexName;
                }
            }
        }

        return array_values(array_unique($names));
    }
}
