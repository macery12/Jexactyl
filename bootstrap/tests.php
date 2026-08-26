<?php

use Illuminate\Support\Str;
use NunoMaduro\Collision\Provider;
use Illuminate\Contracts\Console\Kernel;
use Symfony\Component\Console\Output\ConsoleOutput;

require __DIR__ . '/../vendor/autoload.php';

$arguments = implode(' ', array_map('strval', $_SERVER['argv'] ?? []));
$mentionsIntegration = str_contains($arguments, 'tests/Integration')
    || preg_match('/--testsuite(?:=|\s+)Integration\b/i', $arguments) === 1;
$mentionsOnlyUnit = !$mentionsIntegration && (
    str_contains($arguments, 'tests/Unit')
    || preg_match('/--testsuite(?:=|\s+)Unit\b/i', $arguments) === 1
);

// Integration tests reboot the application, so SQLite's per-connection
// :memory: database loses its schema between requests. Give any run that may
// include Integration tests its own process-scoped file database and migrate it;
// focused Unit runs retain the fast in-memory/skip-migrations path.
if (!$mentionsOnlyUnit && env('SKIP_MIGRATIONS')) {
    $testDatabase = tempnam(sys_get_temp_dir(), 'm12labs-test-');
    if ($testDatabase === false) {
        throw new RuntimeException('Unable to create the PHPUnit integration database.');
    }

    putenv('DB_DATABASE=' . $testDatabase);
    putenv('SKIP_MIGRATIONS=false');
    $_ENV['DB_DATABASE'] = $_SERVER['DB_DATABASE'] = $testDatabase;
    $_ENV['SKIP_MIGRATIONS'] = $_SERVER['SKIP_MIGRATIONS'] = 'false';

    register_shutdown_function(static function () use ($testDatabase): void {
        if (is_file($testDatabase)) {
            unlink($testDatabase);
        }
    });
}

$app = require __DIR__ . '/app.php';

/** @var Everest\Console\Kernel $kernel */
$kernel = $app->make(Kernel::class);

/*
 * Bootstrap the kernel and prepare application for testing.
 */
$kernel->bootstrap();

// Register the collision service provider so that errors during the test
// setup process are output nicely.
(new Provider())->register();

$output = new ConsoleOutput();

$prefix = 'database.connections.' . config('database.default');
if (!Str::contains(config("$prefix.database"), ['test', ':memory:'])) {
    $output->writeln(PHP_EOL . '<error>Cannot run test process against non-testing database.</error>');
    $output->writeln(PHP_EOL . '<error>Environment is currently pointed at: "' . config("$prefix.database") . '".</error>');
    exit(1);
}

/*
 * Perform database migrations and reseeding before continuing with
 * running the tests.
 */
if (!env('SKIP_MIGRATIONS')) {
    $output->writeln(PHP_EOL . '<info>Refreshing database for Integration tests...</info>');
    $kernel->call('migrate:fresh');

    $output->writeln('<info>Seeding database for Integration tests...</info>' . PHP_EOL);
    $kernel->call('db:seed');

    $output->writeln('<info>Database configured, running Integration tests...</info>' . PHP_EOL);
} else {
    $output->writeln(PHP_EOL . '<comment>Skipping database migrations...</comment>' . PHP_EOL);
}
