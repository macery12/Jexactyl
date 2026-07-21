<?php

namespace Everest\Services\Migration;

/**
 * One reconciling statement, plus enough context to explain it to the operator
 * before it runs.
 */
readonly class SchemaChange
{
    /** Cosmetic: same index, historical name. */
    public const KIND_RENAME_INDEX = 'rename-index';

    /** Cosmetic: same constraint, historical name. FKs cannot be renamed in place. */
    public const KIND_REBUILD_FOREIGN_KEY = 'rebuild-foreign-key';

    /** Functional: a table the shipped schema has and this install never got. */
    public const KIND_CREATE_TABLE = 'create-table';

    /** Functional: a column the shipped schema has and this install never got. */
    public const KIND_ADD_COLUMN = 'add-column';

    /** Functional: the column exists but its definition drifted. */
    public const KIND_MODIFY_COLUMN = 'modify-column';

    /** Functional: a foreign key the shipped schema has and this install does not. */
    public const KIND_ADD_FOREIGN_KEY = 'add-foreign-key';

    /** Functional: the index covers the wrong columns and is rebuilt. */
    public const KIND_REBUILD_INDEX = 'rebuild-index';

    /** Functional: an index the shipped schema has and this install does not. */
    public const KIND_CREATE_INDEX = 'create-index';

    /** An index this install has and the shipped schema does not. */
    public const KIND_DROP_INDEX = 'drop-index';

    /** A table the shipped schema no longer has. */
    public const KIND_DROP_TABLE = 'drop-table';

    public function __construct(
        public string $kind,
        public string $table,
        public string $description,
        public array $statements,
        public bool $destructive = false,
    ) {
    }

    /**
     * Cosmetic changes bring index and constraint names into line with the
     * shipped schema. They change no data and no query behaviour, but keeping
     * them aligned means a future migration that drops an index by name finds
     * it on every install.
     */
    public function isCosmetic(): bool
    {
        return in_array($this->kind, [self::KIND_RENAME_INDEX, self::KIND_REBUILD_FOREIGN_KEY], true);
    }

    /**
     * Which pass this change belongs to. Changes are applied a phase at a time,
     * with the plan recomputed from the live schema in between, because an
     * earlier phase routinely changes what a later one needs to do — adding a
     * column can satisfy an index, and rebuilding a foreign key takes its
     * backing index's name with it on MariaDB.
     *
     * Within that, the order is: build what is missing, then correct what is
     * mislabelled, then remove what is surplus. The destructive work happens
     * last so an interruption is as cheap as possible.
     */
    public function phase(): int
    {
        return match ($this->kind) {
            self::KIND_CREATE_TABLE => 0,
            self::KIND_ADD_COLUMN => 1,
            self::KIND_MODIFY_COLUMN => 2,
            self::KIND_ADD_FOREIGN_KEY, self::KIND_REBUILD_FOREIGN_KEY => 3,
            self::KIND_CREATE_INDEX, self::KIND_RENAME_INDEX, self::KIND_REBUILD_INDEX => 4,
            self::KIND_DROP_INDEX => 5,
            self::KIND_DROP_TABLE => 6,
            default => 7,
        };
    }

    /** All phase numbers, in the order they run. */
    public static function phases(): array
    {
        return range(0, 7);
    }
}
