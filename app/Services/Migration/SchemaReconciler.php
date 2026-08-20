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
    /**
     * information_schema lookups for the current pass, cleared by refresh().
     *
     * The plan is recomputed several times per run, and each pass reads every
     * table's columns, indexes and constraints. Without this the command spends
     * most of its time re-asking the server questions whose answers cannot have
     * changed since the last statement it issued.
     *
     * @var array<string, mixed>
     */
    private array $cache = [];

    public function __construct(private readonly Connection $connection)
    {
    }

    /**
     * Forget everything read from information_schema. Called after each phase of
     * changes is applied, so the next plan is computed against the real schema
     * rather than the one that existed when the run started.
     */
    public function refresh(): void
    {
        $this->cache = [];
    }

    /**
     * Differences this tool will not attempt to fix, because correcting them
     * could destroy data. Everything else that used to live here is now planned
     * as a repair instead — see plan().
     *
     * These do not stop the run: the repairs that can be made are still worth
     * making. They stop the migration history from being rewritten, because
     * claiming the consolidated chain on a schema that does not match it would
     * hide the problem from every later upgrade.
     *
     * @return string[]
     */
    public function unrepairableDifferences(SchemaBaseline $baseline): array
    {
        $problems = [];
        $actualTables = $this->tables();

        foreach ($baseline->tableNames() as $table) {
            if ($table === 'migrations' || !in_array($table, $actualTables, true)) {
                continue;
            }

            $actual = $this->columns($table);

            foreach ($baseline->columns($table) as $column => $definition) {
                if (!isset($actual[$column])) {
                    continue;
                }

                // A difference a guided remediation can close is not unrepairable
                // — it is reported and resolved in that pass instead.
                if ($this->remediationFor($table, $column, $definition, $actual[$column]) !== null) {
                    continue;
                }

                if (($reason = $this->lossyColumnChange($table, $column, $definition, $actual[$column])) !== null) {
                    $problems[] = sprintf(
                        '`%s`.`%s`: %s — changing this could truncate or reinterpret existing values, so it is left alone. Correct it by hand.',
                        $table,
                        $column,
                        $reason,
                    );
                }
            }
        }

        return $problems;
    }

    /**
     * Column differences that turn on what the rows mean rather than what shape
     * they are, and so need a decision from the operator before any DDL runs.
     * Each is returned as facts plus a proposal; the command drives the
     * conversation and applies the resulting data fix. See {@see ColumnRemediation}.
     *
     * Recomputed like everything else against the live schema, so once a
     * remediation is applied it stops being reported on the next pass.
     *
     * @return ColumnRemediation[]
     */
    public function remediations(SchemaBaseline $baseline): array
    {
        $remediations = [];
        $actualTables = $this->tables();

        foreach ($baseline->tableNames() as $table) {
            if ($table === 'migrations' || !in_array($table, $actualTables, true)) {
                continue;
            }

            $actual = $this->columns($table);

            foreach ($baseline->columns($table) as $column => $definition) {
                if (!isset($actual[$column])) {
                    continue;
                }

                if (($remediation = $this->remediationFor($table, $column, $definition, $actual[$column])) !== null) {
                    $remediations[] = $remediation;
                }
            }
        }

        return $remediations;
    }

    /**
     * The one remediation a column needs, or null when it needs none. Two shapes
     * are recognised: an integer enum where the shipped schema wants text labels
     * (a value remap), and a NOT NULL column that currently holds NULLs (a fill).
     */
    private function remediationFor(string $table, string $column, array $expected, array $actual): ?ColumnRemediation
    {
        $hint = $this->remediationHints()[$table . '.' . $column] ?? [];

        // A value remap only applies where the shipped column carries a known
        // vocabulary (so "everything else" has a defined neutral value) and the
        // type change preserves the data underneath it.
        if (($hint['kind'] ?? null) === ColumnRemediation::KIND_VALUE_REMAP
            && $this->representationWidening($actual, $expected)) {
            return new ColumnRemediation(
                kind: ColumnRemediation::KIND_VALUE_REMAP,
                table: $table,
                column: $column,
                currentType: $actual['type'],
                targetType: $expected['type'],
                explanation: $hint['explanation'],
                distribution: $this->valueDistribution($table, $column),
                meaningfulTargets: $hint['meaningful'] ?? [],
            );
        }

        // A NOT NULL column that still holds NULLs. Left to the plain plan this
        // would tighten in place and let the database blank every NULL with no
        // warning; instead the operator chooses the fill first.
        if (!$expected['nullable'] && $actual['nullable'] && $this->nullCount($table, $column) > 0) {
            // A shipped default is the obvious fill and needs no thought; a hint
            // supplies one where there is no default; otherwise the operator is
            // asked, and the run cannot proceed unattended.
            $fill = $hint['fill'] ?? $this->defaultFillValue($expected);

            return new ColumnRemediation(
                kind: ColumnRemediation::KIND_NULL_FILL,
                table: $table,
                column: $column,
                currentType: $actual['type'],
                targetType: $expected['type'],
                explanation: $hint['explanation'] ?? sprintf(
                    'The shipped schema makes `%s`.`%s` NOT NULL. Existing NULLs need a value before it can be tightened.',
                    $table,
                    $column,
                ),
                nullCount: $this->nullCount($table, $column),
                proposedFill: $fill,
                safeUnattended: $fill !== null,
            );
        }

        return null;
    }

    /**
     * Per-column knowledge that lets a remediation propose a sensible default.
     * These encode *this panel's* meaning for its own columns, not guesses about
     * any particular source panel — so a value remap only ever suggests, and the
     * operator confirms which source value is which.
     *
     * @return array<string, array<string, mixed>>
     */
    private function remediationHints(): array
    {
        return [
            'users.state' => [
                'kind' => ColumnRemediation::KIND_VALUE_REMAP,
                'meaningful' => ['suspended', 'pending'],
                'explanation' => "This install stores the account state as an integer — a fork's enum — "
                    . "but this panel reads it as text: NULL for a normal account, 'suspended', or 'pending'. "
                    . 'The mapping is by meaning, not by number, so you confirm which code means what; '
                    . 'anything you do not claim becomes a normal (NULL) account.',
            ],
            'egg_variables.rules' => [
                'kind' => ColumnRemediation::KIND_NULL_FILL,
                'fill' => 'nullable|string',
                'explanation' => 'Some variable rule sets are NULL here, but the shipped schema requires a value. '
                    . "'nullable|string' means the variable is optional and unvalidated — the safe, non-restrictive "
                    . "default. Blanking them ('') instead would quietly strip validation from those variables.",
            ],
        ];
    }

    /**
     * Whether changing $actual's type to $expected's keeps every stored value
     * intact — specifically an integer becoming a string wide enough to hold its
     * decimal form. That is what lets a value remap treat the type change as
     * free and spend its attention on the vocabulary instead.
     */
    private function representationWidening(array $actual, array $expected): bool
    {
        if ($this->integerBounds($this->baseType($actual['type']), false) === null) {
            return false;
        }

        if (!in_array($this->baseType($expected['type']), ['varchar', 'char', 'text', 'mediumtext', 'longtext'], true)) {
            return false;
        }

        // The widest 64-bit integer is 20 digits, 21 with a sign; a text type
        // (no size) or any string at least that wide cannot truncate one.
        $size = $this->typeSize($expected['type']);

        return $size === null || $size >= 21;
    }

    /** A NOT NULL column's shipped default as a fill value, or null when it has none. */
    private function defaultFillValue(array $expected): ?string
    {
        if ($expected['default'] === null) {
            return null;
        }

        // Defaults are stored as SQL literals; a value remap works in raw values,
        // so strip one layer of quoting off a string literal.
        $default = $this->defaultLiteral($expected['default']);

        if (preg_match("/^'(.*)'$/s", $default, $m)) {
            return str_replace("''", "'", $m[1]);
        }

        return $default;
    }

    /**
     * Distinct current values of a column and how many rows hold each, for
     * presenting a remap. Capped so a high-cardinality column cannot flood the
     * screen; a remap only makes sense on a low-cardinality enum anyway.
     *
     * @return array<string, int>
     */
    private function valueDistribution(string $table, string $column): array
    {
        $rows = $this->connection->select(sprintf(
            'SELECT `%s` AS v, COUNT(*) AS n FROM `%s` GROUP BY `%s` ORDER BY n DESC LIMIT 50',
            $column,
            $table,
            $column,
        ));

        $distribution = [];

        foreach ($rows as $row) {
            // NULL already means "normal" in the target vocabulary; only concrete
            // values need a decision.
            if ($row->v === null) {
                continue;
            }

            $distribution[(string) $row->v] = (int) $row->n;
        }

        return $distribution;
    }

    private function nullCount(string $table, string $column): int
    {
        return $this->cache['nulls'][$table][$column] ??= (int) $this->connection
            ->table($table)
            ->whereNull($column)
            ->count();
    }

    /**
     * Differences that are safe to live with: things this install has that the
     * shipped schema does not. Dropping a column destroys data, so these are
     * reported and kept.
     *
     * @return string[]
     */
    public function toleratedDifferences(SchemaBaseline $baseline): array
    {
        $notes = [];
        $actualTables = $this->tables();

        foreach ($baseline->tableNames() as $table) {
            if ($table === 'migrations' || !in_array($table, $actualTables, true)) {
                continue;
            }

            foreach (array_diff(array_keys($this->columns($table)), array_keys($baseline->columns($table))) as $column) {
                $notes[] = "`{$table}`.`{$column}` exists here but not in the shipped schema — kept, since dropping it would lose whatever is in it";
            }
        }

        return $notes;
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
            if ($table === 'migrations') {
                continue;
            }

            // A table this install never got is built outright, with its columns
            // and indexes. Its foreign keys are added in a later phase, once
            // every table they might point at exists.
            if (!in_array($table, $actualTables, true)) {
                $changes[] = $this->planCreateTable($baseline, $table);
                $changes = array_merge($changes, $this->planForeignKeys($baseline, $table));

                continue;
            }

            $changes = array_merge(
                $changes,
                $this->planColumns($baseline, $table),
                $this->planForeignKeys($baseline, $table),
                $this->planIndexes($baseline, $table),
            );
        }

        foreach ($dropTables as $table) {
            // The caller resolves these once, before anything runs. By the time
            // the plan is recomputed for a later phase they may already be gone,
            // and re-proposing a drop would look like a change that failed.
            if (!in_array($table, $actualTables, true)) {
                continue;
            }

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
                // Nothing here has this shape. If the column it needs is missing
                // too, the add-column phase creates it first and the recomputed
                // plan picks this up then; if the column is there, the install
                // simply never got the constraint.
                if (!$this->hasColumns($table, $definition['columns'])) {
                    continue;
                }

                $changes[] = new SchemaChange(
                    kind: SchemaChange::KIND_ADD_FOREIGN_KEY,
                    table: $table,
                    description: sprintf(
                        '`%s`: add missing constraint `%s` (%s → `%s`)',
                        $table,
                        $name,
                        implode(', ', $definition['columns']),
                        $definition['refTable'],
                    ),
                    statements: [$this->addForeignKeyStatement($table, $name, $definition)],
                );

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
                    $this->addForeignKeyStatement($table, $name, $definition),
                ],
            );
        }

        return $changes;
    }

    /**
     * Build a table this install never got.
     *
     * Foreign keys are deliberately left out: the table a key points at may not
     * exist yet either. They are added in a later phase, by which point every
     * table does.
     */
    private function planCreateTable(SchemaBaseline $baseline, string $table): SchemaChange
    {
        $lines = [];

        foreach ($baseline->columns($table) as $column => $definition) {
            $lines[] = '  ' . $this->columnDefinition($column, $definition);
        }

        if (($primary = $baseline->primaryKey($table)) !== []) {
            $lines[] = '  PRIMARY KEY (' . $this->quoteList($primary) . ')';
        }

        foreach ($baseline->indexes($table) as $name => $definition) {
            $lines[] = sprintf(
                '  %sKEY `%s` (%s)',
                $definition['unique'] ? 'UNIQUE ' : '',
                $name,
                $this->quoteList($definition['columns']),
            );
        }

        $statement = sprintf(
            "CREATE TABLE `%s` (\n%s\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=%s",
            $table,
            implode(",\n", $lines),
            $baseline->collation($table),
        );

        return new SchemaChange(
            kind: SchemaChange::KIND_CREATE_TABLE,
            table: $table,
            description: sprintf(
                'create missing table `%s` (%d column(s)) — this install predates it',
                $table,
                count($baseline->columns($table)),
            ),
            statements: [$statement],
        );
    }

    /**
     * Columns the shipped schema has that this install does not, plus columns
     * whose definition drifted in a way that can be corrected without risking
     * the values already in them.
     *
     * This is what makes the command usable on installs that tracked the
     * development branch and stopped at different points: each one is missing a
     * different subset, and each subset is added on its own terms.
     *
     * @return SchemaChange[]
     */
    private function planColumns(SchemaBaseline $baseline, string $table): array
    {
        $expected = $baseline->columns($table);
        $actual = $this->columns($table);
        $changes = [];

        // Tracks where each column lands so a run of several missing columns is
        // added in the shipped order rather than all after the same anchor.
        $previous = null;

        foreach ($expected as $column => $definition) {
            if (!isset($actual[$column])) {
                $changes[] = new SchemaChange(
                    kind: SchemaChange::KIND_ADD_COLUMN,
                    table: $table,
                    description: sprintf('`%s`: add missing column `%s` (%s)', $table, $column, $definition['type']),
                    statements: [sprintf(
                        'ALTER TABLE `%s` ADD COLUMN %s%s',
                        $table,
                        $this->columnDefinition($column, $definition),
                        $previous === null ? ' FIRST' : " AFTER `{$previous}`",
                    )],
                    // A NOT NULL column with no default takes the type's zero
                    // value on every existing row. That is a write, so say so.
                    destructive: !$definition['nullable'] && $definition['default'] === null && $this->rowCount($table) > 0,
                );

                $previous = $column;

                continue;
            }

            $previous = $column;

            $differences = $this->describeColumnDifferences($definition, $actual[$column]);

            if ($differences === [] || $this->lossyColumnChange($table, $column, $definition, $actual[$column]) !== null) {
                continue;
            }

            // A column that needs a data decision is handled in the remediation
            // pass, which fills or remaps the rows first; once it has, this plan
            // recomputes and the corrected column falls through to a plain MODIFY.
            if ($this->remediationFor($table, $column, $definition, $actual[$column]) !== null) {
                continue;
            }

            $changes[] = new SchemaChange(
                kind: SchemaChange::KIND_MODIFY_COLUMN,
                table: $table,
                description: sprintf('`%s`.`%s`: %s — corrected', $table, $column, implode('; ', $differences)),
                statements: [sprintf(
                    'ALTER TABLE `%s` MODIFY COLUMN %s',
                    $table,
                    $this->columnDefinition($column, $definition),
                )],
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
            // An index over a column that is still missing has to wait for the
            // add-column phase; the recomputed plan will pick it up then.
            if (!$this->hasColumns($table, $definition['columns'])) {
                continue;
            }

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
     * @param string[] $claimed
     * @param string[] $keys
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

    /**
     * Render a column back into SQL from the structured facts the baseline
     * parsed out of the dump. Clause order follows MySQL's column definition
     * grammar: type, collation, nullability, default, attributes, comment,
     * check.
     */
    private function columnDefinition(string $column, array $definition): string
    {
        $sql = "`{$column}` " . $definition['type'];

        if ($definition['collation'] !== null) {
            $sql .= ' COLLATE ' . $definition['collation'];
        }

        $sql .= $definition['nullable'] ? ' NULL' : ' NOT NULL';

        if ($definition['default'] !== null) {
            $sql .= ' DEFAULT ' . $this->defaultLiteral($definition['default']);
        }

        if ($definition['extra'] !== '') {
            $sql .= ' ' . strtoupper($definition['extra']);
        }

        if ($definition['comment'] !== '') {
            $sql .= " COMMENT '" . str_replace("'", "''", $definition['comment']) . "'";
        }

        // Carried through on all three paths that use this — creating a table,
        // adding a column, correcting one — because MariaDB accepts an inline
        // CHECK on each, and a JSON column is only a JSON column because of it.
        if (($definition['check'] ?? '') !== '') {
            $sql .= ' CHECK (' . $definition['check'] . ')';
        }

        return $sql;
    }

    /**
     * The baseline rewrites defaults that are the date the dump was taken to a
     * placeholder, so two installs compare equal. Writing one back out means
     * putting a real date in again — today's, which is what a fresh install
     * would have got.
     */
    private function defaultLiteral(string $default): string
    {
        return $default === "'<migrate-date>'" ? "'" . date('Y-m-d') . "'" : $default;
    }

    /**
     * Whether correcting this column would risk the values already stored in
     * it. A change of type family reinterprets every row, and a narrower type
     * truncates. Neither is something an upgrade should decide on its own.
     *
     * Returns the reason, or null when the change is safe to make.
     */
    private function lossyColumnChange(string $table, string $column, array $expected, array $actual): ?string
    {
        if ($expected['type'] === $actual['type']) {
            return null;
        }

        $expectedBase = $this->baseType($expected['type']);
        $actualBase = $this->baseType($actual['type']);

        if ($expectedBase !== $actualBase && !$this->interchangeable($actualBase, $expectedBase)) {
            return sprintf('type is `%s`, expected `%s`', $actual['type'], $expected['type']);
        }

        // Integer widths in parentheses are a display hint that MySQL ignores,
        // so comparing them says nothing. What does matter is signedness, which
        // moves the range rather than resizing it.
        if ($this->integerBounds($expectedBase, false) !== null) {
            return $this->signednessChange($table, $column, $expected, $actual);
        }

        $expectedSize = $this->typeSize($expected['type']);
        $actualSize = $this->typeSize($actual['type']);

        if ($expectedSize !== null && $actualSize !== null && $expectedSize < $actualSize) {
            return sprintf('`%s` is wider than the expected `%s`', $actual['type'], $expected['type']);
        }

        return null;
    }

    /**
     * Type pairs that hold the same values, so swapping one for the other
     * cannot reinterpret anything. `char` → `varchar` is the one that turns up
     * in practice: an old migration declared a fixed-width column where the
     * shipped schema has a variable-width one of the same length. Going the
     * other way is not listed — padding a value out to the full width and
     * trimming it back loses trailing spaces.
     */
    private function interchangeable(string $actualBase, string $expectedBase): bool
    {
        return $actualBase === 'char' && $expectedBase === 'varchar';
    }

    /**
     * Whether flipping a column between signed and unsigned would put values
     * already stored in it outside the target's range. The bounds are compared
     * by the database rather than in PHP, because `bigint unsigned` overflows a
     * PHP integer.
     */
    private function signednessChange(string $table, string $column, array $expected, array $actual): ?string
    {
        $unsigned = $this->isUnsigned($expected['type']);

        if ($unsigned === $this->isUnsigned($actual['type'])) {
            return null;
        }

        $bounds = $this->integerBounds($this->baseType($expected['type']), $unsigned);

        if ($bounds === null) {
            return null;
        }

        [$min, $max] = $bounds;

        $offending = $this->connection->selectOne(sprintf(
            'SELECT COUNT(*) AS n FROM `%s` WHERE `%s` < %s OR `%s` > %s',
            $table,
            $column,
            $min,
            $column,
            $max,
        ));

        if ((int) $offending->n === 0) {
            return null;
        }

        return sprintf(
            'type is `%s`, expected `%s`, and %d row(s) hold a value outside the expected range',
            $actual['type'],
            $expected['type'],
            (int) $offending->n,
        );
    }

    private function isUnsigned(string $type): bool
    {
        return str_contains(strtolower($type), 'unsigned');
    }

    /**
     * The inclusive range of an integer type, as numeric literals for SQL. Null
     * for anything that is not an integer type.
     *
     * @return array{string, string}|null
     */
    private function integerBounds(string $base, bool $unsigned): ?array
    {
        $bounds = [
            'tinyint' => [['-128', '127'], ['0', '255']],
            'smallint' => [['-32768', '32767'], ['0', '65535']],
            'mediumint' => [['-8388608', '8388607'], ['0', '16777215']],
            'int' => [['-2147483648', '2147483647'], ['0', '4294967295']],
            'bigint' => [
                ['-9223372036854775808', '9223372036854775807'],
                ['0', '18446744073709551615'],
            ],
        ];

        if (!isset($bounds[$base])) {
            return null;
        }

        return $bounds[$base][$unsigned ? 1 : 0];
    }

    private function baseType(string $type): string
    {
        return strtolower((string) preg_replace('/\s*[(\s].*$/s', '', trim($type)));
    }

    /** The first number in the type's parentheses — length, or precision. */
    private function typeSize(string $type): ?int
    {
        return preg_match('/\((\d+)/', $type, $m) ? (int) $m[1] : null;
    }

    /** @param string[] $columns */
    private function hasColumns(string $table, array $columns): bool
    {
        $present = array_keys($this->columns($table));

        return array_diff($columns, $present) === [];
    }

    private function rowCount(string $table): int
    {
        return $this->cache['rows'][$table] ??= (int) $this->connection->table($table)->count();
    }

    private function addForeignKeyStatement(string $table, string $name, array $definition): string
    {
        return sprintf(
            'ALTER TABLE `%s` ADD CONSTRAINT `%s` FOREIGN KEY (%s) REFERENCES `%s` (%s)%s%s',
            $table,
            $name,
            $this->quoteList($definition['columns']),
            $definition['refTable'],
            $this->quoteList($definition['refColumns']),
            $definition['onDelete'] ? ' ON DELETE ' . $definition['onDelete'] : '',
            $definition['onUpdate'] ? ' ON UPDATE ' . $definition['onUpdate'] : '',
        );
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
        return $this->cache['tables'] ??= array_map(
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
        if (isset($this->cache['columns'][$table])) {
            return $this->cache['columns'][$table];
        }

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

        return $this->cache['columns'][$table] = $columns;
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
        if (isset($this->cache['indexes'][$table])) {
            return $this->cache['indexes'][$table];
        }

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

        return $this->cache['indexes'][$table] = $indexes;
    }

    /** @return array<string, array> */
    private function foreignKeys(string $table): array
    {
        if (isset($this->cache['foreignKeys'][$table])) {
            return $this->cache['foreignKeys'][$table];
        }

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

        return $this->cache['foreignKeys'][$table] = $keys;
    }

    /** @return string[] */
    private function foreignKeyBackingIndexes(string $table): array
    {
        $names = [];
        $indexes = $this->indexes($table);

        foreach ($this->foreignKeys($table) as $key) {
            foreach ($indexes as $indexName => $index) {
                // InnoDB accepts any index whose leading columns cover the key.
                if (array_slice($index['columns'], 0, count($key['columns'])) === $key['columns']) {
                    $names[] = $indexName;
                }
            }
        }

        return array_values(array_unique($names));
    }
}
