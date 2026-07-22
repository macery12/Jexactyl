<?php

namespace Everest\Services\Migration;

/**
 * Describes how one table is copied out of a source panel and into this one.
 *
 * The importer is schema-driven: it copies the intersection of the source and
 * target columns and only needs to be told about the parts it cannot infer —
 * renamed columns, columns that are deliberately left behind, values that have
 * to be recomputed, and defaults for target columns the source has no answer
 * for. Anything it cannot account for stops the import rather than guessing.
 */
class TablePlan
{
    public const GROUP_CORE = 'core';
    public const GROUP_LOGS = 'logs';
    public const GROUP_BILLING = 'billing';

    /**
     * @param string $table target table name
     * @param string|null $sourceTable source table name, when it differs from the target
     * @param array<string, string> $renames source column => target column
     * @param array<string, string> $drops source column => reason it is not carried over
     * @param array<string, string> $converted source column => where its value ends up instead.
     *                                         Like $drops in that no column copies it directly, but the value is not lost, so it is
     *                                         reported separately from real data loss.
     * @param array<string, mixed|\Closure> $defaults target column => value, or fn (array $row) => value
     * @param array<string, \Closure> $transforms target column => fn (mixed $value, array $row, ImportContext $ctx) => mixed
     * @param string $group core, logs or billing — selects which flags include this table
     * @param \Closure|null $filter fn (array $row) => bool, rows returning false are skipped
     */
    public function __construct(
        public readonly string $table,
        public readonly ?string $sourceTable = null,
        public readonly array $renames = [],
        public readonly array $drops = [],
        public readonly array $converted = [],
        public readonly array $defaults = [],
        public readonly array $transforms = [],
        public readonly string $group = self::GROUP_CORE,
        public readonly ?\Closure $filter = null,
    ) {
    }

    public function sourceTable(): string
    {
        return $this->sourceTable ?? $this->table;
    }

    /**
     * Resolve the target column a source column feeds, or null when the column
     * is deliberately dropped.
     */
    public function targetColumn(string $sourceColumn): ?string
    {
        if (array_key_exists($sourceColumn, $this->drops) || array_key_exists($sourceColumn, $this->converted)) {
            return null;
        }

        return $this->renames[$sourceColumn] ?? $sourceColumn;
    }
}
