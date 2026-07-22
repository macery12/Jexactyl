<?php

namespace Everest\Services\Migration;

/**
 * The shipped target schema, parsed out of database/schema/fresh-schema.sql.
 *
 * That file is a structure-only dump of a fresh install, regenerated whenever
 * the migrations change (see scripts/schema-diff.sh). Reading it here means the
 * upgrade path compares an existing install against the same artifact CI does,
 * rather than against a second, hand-maintained description that could drift.
 */
class SchemaBaseline
{
    public const PATH = 'database/schema/fresh-schema.sql';

    public const LEGACY_CHAIN_PATH = 'database/schema/legacy-migrations.txt';

    /** @var array<string, array{columns: array<string, array>, indexes: array, foreignKeys: array, collation: string}> */
    private array $tables = [];

    private function __construct()
    {
    }

    public static function load(string $path): self
    {
        if (!is_readable($path)) {
            throw new \RuntimeException("The schema baseline is missing or unreadable: {$path}");
        }

        $baseline = new self();
        $baseline->parse((string) file_get_contents($path));

        if ($baseline->tables === []) {
            throw new \RuntimeException("No CREATE TABLE statements found in {$path} — the baseline looks truncated.");
        }

        return $baseline;
    }

    /**
     * The migration filenames the panel ships today, taken from the migration
     * directory rather than a second list that could fall out of step.
     *
     * @return string[]
     */
    public static function currentChain(string $migrationPath): array
    {
        $names = [];

        foreach (glob(rtrim($migrationPath, '/') . '/*.php') ?: [] as $file) {
            $names[] = basename($file, '.php');
        }

        sort($names);

        return $names;
    }

    /**
     * The pre-rebuild migration chain, shipped as a manifest so the check still
     * works once database/migrations_legacy/ is deleted (D7).
     *
     * @return string[]
     */
    public static function legacyChain(string $path): array
    {
        if (!is_readable($path)) {
            throw new \RuntimeException("The legacy migration manifest is missing: {$path}");
        }

        $names = array_values(array_filter(array_map(
            'trim',
            explode("\n", (string) file_get_contents($path))
        )));

        sort($names);

        return $names;
    }

    /** @return string[] */
    public function tableNames(): array
    {
        return array_keys($this->tables);
    }

    public function hasTable(string $table): bool
    {
        return isset($this->tables[$table]);
    }

    /**
     * Columns as structured facts rather than as a rendered SQL string, so they
     * can be compared against information_schema without either side having to
     * reproduce mysqldump's exact formatting.
     *
     * @return array<string, array{type: string, nullable: bool, default: ?string, extra: string, collation: ?string, comment: string}>
     */
    public function columns(string $table): array
    {
        return $this->tables[$table]['columns'] ?? [];
    }

    /** @return array<string, array{columns: string[], unique: bool}> */
    public function indexes(string $table): array
    {
        return $this->tables[$table]['indexes'] ?? [];
    }

    /** @return array<string, array{columns: string[], refTable: string, refColumns: string[], onDelete: ?string, onUpdate: ?string}> */
    public function foreignKeys(string $table): array
    {
        return $this->tables[$table]['foreignKeys'] ?? [];
    }

    /**
     * The primary key's columns. Needed to recreate a table an install never
     * got; the upgrade never alters an existing one.
     *
     * @return string[]
     */
    public function primaryKey(string $table): array
    {
        return $this->tables[$table]['primaryKey'] ?? [];
    }

    public function collation(string $table): string
    {
        return $this->tables[$table]['collation'] ?? 'utf8mb4_unicode_ci';
    }

    private function parse(string $sql): void
    {
        if (!preg_match_all('/CREATE TABLE `([^`]+)` \((.*?)\n\) ENGINE([^;]*);/s', $sql, $matches, PREG_SET_ORDER)) {
            return;
        }

        foreach ($matches as [, $table, $body, $tail]) {
            $this->tables[$table] = [
                'columns' => [],
                'indexes' => [],
                'foreignKeys' => [],
                'primaryKey' => [],
                // Columns that do not name a collation inherit the table's.
                'collation' => preg_match('/COLLATE=(\S+)/', $tail, $m) ? $m[1] : 'utf8mb4_unicode_ci',
            ];

            foreach (explode("\n", $body) as $line) {
                $this->parseLine($table, rtrim(trim($line), ','));
            }
        }
    }

    private function parseLine(string $table, string $line): void
    {
        if ($line === '') {
            return;
        }

        // PRIMARY KEY is never renamed or rebuilt on a table that already exists
        // — it is part of the table's identity, and a mismatch there is a hard
        // stop, not a fix. It is recorded only so a missing table can be created
        // with the right one.
        if (str_starts_with($line, 'PRIMARY KEY')) {
            $this->tables[$table]['primaryKey'] = $this->columnList($line);

            return;
        }

        if (preg_match('/^CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]*)\) REFERENCES `([^`]+)` \(([^)]*)\)(.*)$/', $line, $m)) {
            $this->tables[$table]['foreignKeys'][$m[1]] = [
                'columns' => $this->columnList($m[2]),
                'refTable' => $m[3],
                'refColumns' => $this->columnList($m[4]),
                'onDelete' => $this->referentialAction($m[5], 'DELETE'),
                'onUpdate' => $this->referentialAction($m[5], 'UPDATE'),
            ];

            return;
        }

        if (preg_match('/^(UNIQUE |FULLTEXT |)KEY `([^`]+)` \(([^)]*)\)/', $line, $m)) {
            $this->tables[$table]['indexes'][$m[2]] = [
                'columns' => $this->columnList($m[3]),
                'unique' => trim($m[1]) === 'UNIQUE',
            ];

            return;
        }

        if (preg_match('/^`([^`]+)` (.+)$/', $line, $m)) {
            $this->tables[$table]['columns'][$m[1]] = $this->parseColumn($table, $m[2]);
        }
    }

    /**
     * @return array{type: string, nullable: bool, default: ?string, extra: string, collation: ?string, comment: string}
     */
    private function parseColumn(string $table, string $definition): array
    {
        // Peel off the trailing clauses first — a COMMENT can contain any of the
        // keywords the rest of the parse looks for.
        $comment = '';
        if (preg_match("/ COMMENT '((?:[^']|'')*)'/", $definition, $m)) {
            $comment = str_replace("''", "'", $m[1]);
            $definition = str_replace($m[0], '', $definition);
        }

        // JSON columns are longtext plus a json_valid CHECK on MariaDB. The
        // check is implied by the utf8mb4_bin collation, so it needs no
        // comparison of its own.
        $definition = (string) preg_replace('/ CHECK \(.*\)$/', '', $definition);

        $collation = null;
        if (preg_match('/ COLLATE (\S+)/', $definition, $m)) {
            $collation = $m[1];
            $definition = str_replace($m[0], '', $definition);
        }
        $definition = (string) preg_replace('/ CHARACTER SET \S+/', '', $definition);

        $default = null;
        if (preg_match("/ DEFAULT (NULL|'(?:[^']|'')*'|\S+)/", $definition, $m)) {
            $default = $this->normaliseDefault($m[1]);
            $definition = str_replace($m[0], '', $definition);
        }

        $extra = '';
        if (preg_match('/ (AUTO_INCREMENT|ON UPDATE \S+)/i', $definition, $m)) {
            $extra = strtolower(trim($m[1]));
            $definition = str_replace($m[0], '', $definition);
        }

        $nullable = !str_contains($definition, 'NOT NULL');
        $type = trim((string) preg_replace('/ (NOT NULL|NULL)/', '', $definition));

        return [
            'type' => $type,
            'nullable' => $nullable,
            'default' => $default,
            'extra' => $extra,
            'collation' => $collation ?? ($this->isStringType($type) ? $this->tables[$table]['collation'] : null),
            'comment' => $comment,
        ];
    }

    private function isStringType(string $type): bool
    {
        return (bool) preg_match('/^(var)?char|text$|^(tiny|medium|long)text|^enum|^set\(/i', $type);
    }

    /**
     * email_quotas' reset dates default to the date the install was migrated, so
     * they differ between any two installs by design.
     */
    private function normaliseDefault(string $default): string
    {
        return (string) preg_replace("/^'\\d{4}-\\d{2}-\\d{2}'$/", "'<migrate-date>'", $default);
    }

    /** @return string[] */
    private function columnList(string $raw): array
    {
        preg_match_all('/`([^`]+)`/', $raw, $m);

        return $m[1];
    }

    private function referentialAction(string $tail, string $event): ?string
    {
        if (preg_match('/ON ' . $event . ' (CASCADE|SET NULL|RESTRICT|NO ACTION)/', $tail, $m)) {
            return $m[1];
        }

        return null;
    }
}
