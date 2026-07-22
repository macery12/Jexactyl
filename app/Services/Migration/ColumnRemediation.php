<?php

namespace Everest\Services\Migration;

/**
 * A column difference that cannot be closed by DDL alone because it turns on
 * what the rows *mean*, not just what shape they are. The schema comparison can
 * see that `users.state` is an integer where the shipped schema wants text, but
 * only a human knows which integer stood for "suspended". So instead of
 * silently coercing (which loses meaning) or flatly refusing (which strands the
 * upgrade), the command walks the operator through the decision and builds the
 * data fix from their answers.
 *
 * The reconciler produces these as *facts and a proposal*: the current data
 * distribution, the target the schema wants, and a suggested default. It issues
 * no prompts and runs no DDL itself — the command owns the conversation.
 */
readonly class ColumnRemediation
{
    /**
     * The column holds the right data under a different vocabulary — an integer
     * enum where the shipped schema uses text labels. The type change itself is
     * lossless (every integer has a string form); what needs deciding is which
     * source value becomes which label. Everything the operator does not claim
     * as meaningful falls back to the target's neutral value.
     */
    public const KIND_VALUE_REMAP = 'value-remap';

    /**
     * The shipped schema forbids NULL in a column that currently holds some.
     * Tightening it as-is would let the database coerce every NULL to the type's
     * empty value with no warning; instead the operator chooses what those rows
     * should say, and only then is the column made NOT NULL.
     */
    public const KIND_NULL_FILL = 'null-fill';

    /**
     * @param array<string, int> $distribution current value (as string) => row count, for a VALUE_REMAP
     * @param string[] $meaningfulTargets target values a source value may map to; anything else becomes the neutral value
     */
    public function __construct(
        public string $kind,
        public string $table,
        public string $column,
        public string $currentType,
        public string $targetType,
        public string $explanation,
        public array $distribution = [],
        public array $meaningfulTargets = [],
        public int $nullCount = 0,
        public ?string $proposedFill = null,
        public bool $safeUnattended = false,
    ) {
    }

    public function target(): string
    {
        return "`{$this->table}`.`{$this->column}`";
    }
}
