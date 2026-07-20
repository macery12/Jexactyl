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
}
