<?php

namespace Everest\Services\Extensions;

use Everest\Exceptions\DisplayException;
use Illuminate\Console\OutputStyle;
use Illuminate\Database\Migrations\Migrator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\BufferedOutput;

/**
 * Runs and rolls back the migrations an extension package ships under
 * app/Extensions/Packages/<id>/database/migrations/.
 *
 * Uses the framework Migrator directly (not artisan) so operations are scoped
 * to the package's migration path and their results can be captured for the
 * audit log. Data-dropping operations (reset) are only ever invoked from the
 * opt-in uninstall --drop-data flow; a default uninstall leaves the
 * extension's tables and migration records untouched.
 */
class ExtensionMigrationService
{
    public const MIGRATIONS_DIR = 'database/migrations';

    public function migrationPath(string $extensionId): string
    {
        return sprintf('app/Extensions/Packages/%s/%s', $extensionId, self::MIGRATIONS_DIR);
    }

    public function hasMigrations(string $extensionId): bool
    {
        $path = base_path($this->migrationPath($extensionId));

        return is_dir($path) && glob($path . '/*.php') !== [];
    }

    /**
     * Run all pending migrations in the extension's migration path.
     *
     * @return array{files: array<int, string>, output: string} the migration
     *                                                          files applied by this call and the captured migrator output
     */
    public function run(string $extensionId): array
    {
        $migrator = $this->migrator();
        $buffer = $this->captureOutput($migrator);

        $ran = $migrator->run([base_path($this->migrationPath($extensionId))]);

        return ['files' => $ran, 'output' => $buffer->fetch()];
    }

    /**
     * Roll back the most recent batch, scoped to the extension's migration
     * files. Only used to revert migrations applied by a failed install or
     * update; migrations from other batches are never touched.
     *
     * @return array{rolledBack: array<int, string>, output: string}
     */
    public function rollbackLastBatch(string $extensionId): array
    {
        $lastBatch = array_map(
            fn ($migration) => (string) ((object) $migration)->migration,
            $this->migrator()->getRepository()->getLast()
        );

        return $this->rollbackMigrations(
            $extensionId,
            array_values(array_intersect($this->ranMigrationNames($extensionId), $lastBatch))
        );
    }

    /**
     * Roll back every ran migration belonging to the extension, regardless of
     * batch. This drops the extension's tables (assuming well-formed down()
     * methods) — only reachable through the audited uninstall --drop-data flow.
     *
     * @return array{rolledBack: array<int, string>, output: string}
     */
    public function reset(string $extensionId): array
    {
        return $this->rollbackMigrations($extensionId, $this->ranMigrationNames($extensionId));
    }

    /**
     * Run down() for exactly the named migrations, newest first.
     *
     * The framework's rollback/reset entry points read the whole migrations
     * table and report every record they cannot resolve to a file in the given
     * path — for a package migration path that means one real rollback and a
     * "Migration not found" line for every core migration ever run, which makes
     * the audit log unreadable. Driving the migrator with an explicit list keeps
     * the log to the extension's own migrations.
     *
     * @param array<int, string> $migrationNames
     * @return array{rolledBack: array<int, string>, output: string}
     */
    private function rollbackMigrations(string $extensionId, array $migrationNames): array
    {
        $migrator = $this->scopedMigrator();
        $buffer = $this->captureOutput($migrator);

        if ($migrationNames === []) {
            return ['rolledBack' => [], 'output' => ''];
        }

        $rolledBack = $migrator->rollbackOnly(
            array_reverse($migrationNames),
            [base_path($this->migrationPath($extensionId))]
        );

        return [
            'rolledBack' => array_map(fn (string $file) => $migrator->getMigrationName($file), $rolledBack),
            'output' => $buffer->fetch(),
        ];
    }

    /**
     * Migration names (filenames without extension) from the extension's
     * migration path that are recorded as ran in the migrations table.
     *
     * @return array<int, string>
     */
    public function ranMigrationNames(string $extensionId): array
    {
        $names = array_map(
            fn (string $file) => basename($file, '.php'),
            glob(base_path($this->migrationPath($extensionId)) . '/*.php') ?: []
        );

        if ($names === []) {
            return [];
        }

        try {
            $ran = $this->migrator()->getRepository()->getRan();
        } catch (\Throwable) {
            return [];
        }

        return array_values(array_intersect($names, $ran));
    }

    /**
     * Table names owned by the extension under the ext_<id>_ prefix convention.
     *
     * @return array<int, string>
     */
    public function listExtensionTables(string $extensionId): array
    {
        try {
            $rows = DB::select(
                'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?',
                [str_replace('_', '\\_', $this->tablePrefix($extensionId)) . '%']
            );
        } catch (\Throwable) {
            return [];
        }

        return array_map(fn ($row) => (string) $row->name, $rows);
    }

    /**
     * SQL statements an operator can run by hand to remove the extension's
     * data when the automated drop was declined or failed. Included in CLI
     * output, the migration log, and the API error payload.
     *
     * @param array<int, string>|null $migrationNames
     * @return array<int, string>
     */
    public function manualCleanupStatements(string $extensionId, ?array $migrationNames = null): array
    {
        $statements = array_map(
            fn (string $table) => sprintf('DROP TABLE IF EXISTS `%s`;', $table),
            $this->listExtensionTables($extensionId)
        );

        $migrationNames ??= $this->ranMigrationNames($extensionId);
        if ($migrationNames !== []) {
            $statements[] = sprintf(
                "DELETE FROM `migrations` WHERE `migration` IN (%s);",
                implode(', ', array_map(fn (string $name) => "'" . $name . "'", $migrationNames))
            );
        }

        return $statements;
    }

    /**
     * Parse the table names a set of migration files create via Schema::create.
     *
     * A source-level regex — it only detects CREATEs (not ALTER/DROP/index
     * changes), which is enough for the namespace check and for previewing the
     * tables an install/update will add. Files may be on disk (an installed
     * extension) or freshly extracted from an archive (a not-yet-installed one).
     *
     * @param array<int, string> $migrationFilePaths absolute paths
     * @return array<int, string> distinct created table names, in file order
     */
    public function parseCreatedTables(array $migrationFilePaths): array
    {
        $tables = [];

        foreach ($migrationFilePaths as $filePath) {
            if (!is_file($filePath)) {
                continue;
            }

            $source = (string) file_get_contents($filePath);
            preg_match_all("/Schema::create\\(\\s*['\"]([^'\"]+)['\"]/", $source, $matches);

            foreach ($matches[1] as $table) {
                if (!in_array($table, $tables, true)) {
                    $tables[] = $table;
                }
            }
        }

        return $tables;
    }

    /**
     * Reject migrations that create tables outside the extension's ext_<id>_
     * namespace. A source-level regex, so it is defense-in-depth against
     * accidents — deliberate evasion is equivalent to shipping malicious PHP,
     * which manual review owns.
     *
     * @param array<int, string> $migrationFilePaths absolute paths
     */
    public function assertTablePrefixConvention(string $extensionId, array $migrationFilePaths): void
    {
        $prefix = $this->tablePrefix($extensionId);

        foreach ($migrationFilePaths as $filePath) {
            if (!is_file($filePath)) {
                continue;
            }

            $source = (string) file_get_contents($filePath);
            preg_match_all("/Schema::create\\(\\s*['\"]([^'\"]+)['\"]/", $source, $matches);

            foreach ($matches[1] as $table) {
                if (!str_starts_with($table, $prefix)) {
                    throw new DisplayException(sprintf(
                        'The migration "%s" creates the table "%s", which is outside the extension\'s allowed "%s" table namespace.',
                        basename($filePath),
                        $table,
                        $prefix
                    ));
                }
            }
        }
    }

    public function tablePrefix(string $extensionId): string
    {
        return sprintf('ext_%s_', $extensionId);
    }

    /**
     * Persist an audit record of a migration operation to a dedicated file in
     * the Laravel log directory. Written for every data-drop (success or
     * failure) and for any migration error during install/update.
     *
     * @param array<string, mixed> $context
     * @return string the log file path
     */
    public function writeMigrationLog(string $extensionId, string $operation, array $context, ?\Throwable $exception = null): string
    {
        $path = storage_path(sprintf('logs/extension-migrations-%s-%s.log', $extensionId, now()->format('Ymd-His')));

        $lines = [
            sprintf('[%s] extension: %s', now()->toIso8601String(), $extensionId),
            sprintf('operation: %s', $operation),
            sprintf('result: %s', $exception === null ? 'success' : 'FAILED'),
        ];

        foreach ($context as $key => $value) {
            if (is_array($value)) {
                $lines[] = $key . ':';
                foreach ($value as $item) {
                    $lines[] = '  - ' . (is_scalar($item) ? (string) $item : json_encode($item));
                }

                continue;
            }

            $lines[] = sprintf('%s: %s', $key, is_scalar($value) ? (string) $value : json_encode($value));
        }

        if ($exception !== null) {
            $lines[] = 'error: ' . $exception->getMessage();
            $lines[] = $exception->getTraceAsString();
        }

        File::ensureDirectoryExists(dirname($path));
        File::put($path, implode(PHP_EOL, $lines) . PHP_EOL);

        return $path;
    }

    private function migrator(): Migrator
    {
        /** @var Migrator $migrator */
        $migrator = app('migrator');

        if (!$migrator->repositoryExists()) {
            $migrator->getRepository()->createRepository();
        }

        return $migrator;
    }

    /**
     * A Migrator that can roll back an explicit list of migrations. Built from
     * the same container bindings the framework uses for the shared 'migrator'
     * instance, so connections, events and the migrations table are identical.
     */
    private function scopedMigrator(): Migrator
    {
        $migrator = new class(app('migration.repository'), app('db'), app('files'), app('events')) extends Migrator {
            /**
             * @param array<int, string> $migrationNames in the order to run down
             * @param array<int, string> $paths
             * @return array<int, string> the migration files rolled back
             */
            public function rollbackOnly(array $migrationNames, array $paths): array
            {
                return $this->resetMigrations($migrationNames, $paths);
            }
        };

        if (!$migrator->repositoryExists()) {
            $migrator->getRepository()->createRepository();
        }

        return $migrator;
    }

    private function captureOutput(Migrator $migrator): BufferedOutput
    {
        $buffer = new BufferedOutput();
        $migrator->setOutput(new OutputStyle(new ArrayInput([]), $buffer));

        return $buffer;
    }
}
