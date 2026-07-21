<?php

namespace Everest\Services\Migration;

use Illuminate\Database\Connection;

/**
 * A source panel the importer knows how to read.
 *
 * Each profile is pinned to a single upstream version. Mapping every historical
 * schema variant of every fork is not tractable; asking the operator to update
 * their old panel to its final release before importing is.
 */
abstract class ImportProfile
{
    /** CLI value for --from. */
    abstract public function key(): string;

    /** Human-readable name used in output. */
    abstract public function name(): string;

    /** The upstream version this profile was derived from and is supported against. */
    abstract public function supportedVersion(): string;

    /**
     * Tables to copy, in foreign-key dependency order.
     *
     * @return TablePlan[]
     */
    abstract public function tables(): array;

    /**
     * Tables that exist in the source and are deliberately never imported.
     *
     * @return array<string, string> table => reason shown to the operator
     */
    abstract public function excludedTables(): array;

    /**
     * Caveats worth reading before starting — things that are lost, changed, or
     * need manual work afterwards. Surfaced by --dry-run and before the
     * confirmation prompt.
     *
     * @return string[]
     */
    public function warnings(): array
    {
        return [];
    }

    /**
     * Hook for data that does not map table-to-table — a source column that has
     * become a pivot table in this panel, for instance. Runs inside the import
     * transaction, after every planned table has been copied.
     */
    public function afterImport(Connection $source, Connection $target, ImportSummary $summary): void
    {
    }

    /**
     * Source columns holding APP_KEY-encrypted values, as table => [columns].
     * The pre-flight probe samples these to verify --source-key before writing.
     *
     * @return array<string, string[]>
     */
    public function encryptedColumns(): array
    {
        return [
            'users' => ['totp_secret'],
            'nodes' => ['daemon_token'],
            'api_keys' => ['token'],
            'database_hosts' => ['password'],
            'databases' => ['password'],
        ];
    }
}
