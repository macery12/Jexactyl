<?php

namespace Everest\Tests\Unit\Services\Migration;

use Everest\Tests\TestCase;
use Everest\Services\Migration\SchemaBaseline;

/**
 * Guards the one artifact the upgrade path cannot recover from being wrong.
 *
 * `database/schema/fresh-schema.sql` is the only description of the shipped
 * schema that `p:migrate:adopt` has. An install that predates a table is given
 * that table by copying it out of this file — so a table the file does not
 * mention is a table the upgrade cannot build, while the migration that would
 * have built it is still marked applied. The install ends up permanently short
 * of a table, and `php artisan migrate` reports nothing pending.
 *
 * `scripts/schema-diff.sh` catches this by migrating into a scratch database
 * and diffing, which needs a MariaDB server and so cannot run here. What can
 * run here is the half that actually rots: whether the migrations create
 * anything the baseline has never heard of.
 */
class SchemaBaselineTest extends TestCase
{
    public function testEveryTableAMigrationCreatesIsInTheBaseline(): void
    {
        $baseline = SchemaBaseline::load(base_path(SchemaBaseline::PATH));

        $created = $this->tablesCreatedByMigrations();

        $this->assertNotEmpty($created, 'No Schema::create() calls were found — the test is not actually checking anything.');

        foreach ($created as $table => $migration) {
            $this->assertTrue(
                $baseline->hasTable($table),
                "`{$table}` is created by {$migration} but is absent from " . SchemaBaseline::PATH
                    . '. Regenerate the baseline with scripts/schema-diff.sh and commit it, or p:migrate:adopt will mark that migration applied without ever creating the table.'
            );
        }
    }

    /**
     * The reverse direction. A baseline carrying a table no migration builds
     * means the dump was taken from a database that had drifted, and every
     * install adopted against it inherits the stray table.
     */
    public function testTheBaselineDescribesNothingTheMigrationsDoNotBuild(): void
    {
        $baseline = SchemaBaseline::load(base_path(SchemaBaseline::PATH));

        $created = $this->tablesCreatedByMigrations();

        // Laravel's own bookkeeping table, created by the migrator itself
        // before any migration runs.
        $created['migrations'] = 'the framework';

        foreach ($baseline->tableNames() as $table) {
            $this->assertArrayHasKey(
                $table,
                $created,
                "`{$table}` is in " . SchemaBaseline::PATH . ' but no migration creates it. The dump was taken from a database that had drifted.'
            );
        }
    }

    /**
     * JSON columns are longtext plus a `json_valid` CHECK on MariaDB, and the
     * upgrade rebuilds a missing table from the parsed baseline alone. If the
     * check is not among the facts it parses, every JSON column on every table
     * the upgrade creates silently accepts what a fresh install rejects.
     */
    public function testJsonColumnsCarryTheirValidityCheck(): void
    {
        $baseline = SchemaBaseline::load(base_path(SchemaBaseline::PATH));

        $checked = 0;

        foreach ($baseline->tableNames() as $table) {
            foreach ($baseline->columns($table) as $column => $definition) {
                if ($definition['collation'] !== 'utf8mb4_bin') {
                    continue;
                }

                $this->assertSame(
                    "json_valid(`{$column}`)",
                    $definition['check'],
                    "`{$table}`.`{$column}` is a JSON column whose json_valid check was not parsed out of the baseline."
                );

                ++$checked;
            }
        }

        $this->assertGreaterThan(0, $checked, 'No JSON columns were found — the test is not actually checking anything.');
    }

    /**
     * Table name => the migration that creates it.
     *
     * @return array<string, string>
     */
    private function tablesCreatedByMigrations(): array
    {
        $created = [];

        foreach (glob(database_path('migrations') . '/*.php') ?: [] as $file) {
            $source = (string) file_get_contents($file);

            preg_match_all("/Schema::create\(\s*'([^']+)'/", $source, $matches);

            foreach ($matches[1] as $table) {
                $created[$table] = basename($file);
            }
        }

        // Dropped again by a later migration in the same chain, so a fresh
        // install never ends up with it.
        foreach (glob(database_path('migrations') . '/*.php') ?: [] as $file) {
            preg_match_all("/Schema::dropIfExists\(\s*'([^']+)'/", (string) file_get_contents($file), $matches);

            foreach ($matches[1] as $table) {
                if (isset($created[$table]) && basename($file) > $created[$table]) {
                    unset($created[$table]);
                }
            }
        }

        return $created;
    }
}
