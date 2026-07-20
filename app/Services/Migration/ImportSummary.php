<?php

namespace Everest\Services\Migration;

/**
 * Everything the operator needs to see after (or instead of) an import: what
 * moved, what did not, and what was left behind on purpose.
 */
class ImportSummary
{
    /** @var array<string, int> target table => rows written */
    public array $copied = [];

    /** @var array<string, string> table => why it was skipped */
    public array $skipped = [];

    /** @var string[] */
    public array $notes = [];

    /** @var string[] */
    public array $warnings = [];

    /** @var array<int, array{table: string, column: string, rows: int, reason: string}> */
    public array $droppedColumns = [];

    public function copied(string $table, int $rows): void
    {
        $this->copied[$table] = ($this->copied[$table] ?? 0) + $rows;
    }

    public function skipped(string $table, string $reason): void
    {
        $this->skipped[$table] = $reason;
    }

    public function note(string $message): void
    {
        $this->notes[] = $message;
    }

    public function warn(string $message): void
    {
        $this->warnings[] = $message;
    }

    /**
     * Record a source column with no home in the target schema. $rows is the
     * number of rows where it held a value, so the operator can tell an empty
     * column apart from real data being left behind.
     */
    public function dropColumn(string $table, string $column, int $rows, string $reason): void
    {
        $this->droppedColumns[] = compact('table', 'column', 'rows', 'reason');
    }

    public function totalRows(): int
    {
        return array_sum($this->copied);
    }

    /** Dropped columns that actually held data. */
    public function lossyColumns(): array
    {
        return array_values(array_filter($this->droppedColumns, fn ($d) => $d['rows'] > 0));
    }
}
