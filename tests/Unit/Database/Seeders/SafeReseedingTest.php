<?php

namespace Everest\Tests\Unit\Database\Seeders;

use Everest\Models\Egg;
use Everest\Tests\TestCase;
use Illuminate\Support\Str;
use Database\Seeders\EggSeeder;
use Illuminate\Console\Command;
use Illuminate\Database\Seeder;
use Database\Seeders\NestSeeder;
use Illuminate\Support\Facades\DB;
use Database\Seeders\WebhookSeeder;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Support\Facades\Schema;
use Database\Seeders\ThemePresetSeeder;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Database\Schema\Blueprint;
use Database\Seeders\InvoiceSettingsSeeder;
use Symfony\Component\Console\Output\BufferedOutput;
use Database\Seeders\EmailNotificationSettingsSeeder;

class SafeReseedingTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        Schema::create('nests', function (Blueprint $table): void {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->string('author');
            $table->string('name');
            $table->text('description')->nullable();
            $table->timestamps();
        });

        Schema::create('eggs', function (Blueprint $table): void {
            $table->increments('id');
            $table->char('uuid', 36)->unique();
            $table->unsignedInteger('nest_id')->index();
            $table->string('author');
            $table->string('name');
            $table->text('description')->nullable();
            $table->json('features')->nullable();
            $table->json('docker_images')->nullable();
            $table->json('file_denylist')->nullable();
            $table->text('update_url')->nullable();
            $table->text('config_files')->nullable();
            $table->text('config_startup')->nullable();
            $table->string('config_stop')->nullable();
            $table->unsignedInteger('config_from')->nullable();
            $table->text('startup')->nullable();
            $table->string('script_container')->default('ghcr.io/pterodactyl/installers:alpine');
            $table->unsignedInteger('copy_script_from')->nullable();
            $table->string('script_entry')->default('/bin/ash');
            $table->boolean('script_is_privileged')->default(true);
            $table->text('script_install')->nullable();
            $table->boolean('force_outgoing_ip')->default(false);
            $table->timestamps();
        });

        Schema::create('egg_variables', function (Blueprint $table): void {
            $table->increments('id');
            $table->unsignedInteger('egg_id');
            $table->string('name');
            $table->text('description');
            $table->string('env_variable');
            $table->text('default_value');
            $table->unsignedTinyInteger('user_viewable');
            $table->unsignedTinyInteger('user_editable');
            $table->text('rules');
            $table->string('field_type')->default('text');
            $table->timestamps();
        });

        Schema::create('theme_presets', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('name');
            $table->json('colors');
            $table->boolean('is_builtin')->default(false);
            $table->timestamps();
        });

        Schema::create('webhook_events', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('key');
            $table->text('description');
            $table->boolean('enabled')->default(false);
            $table->timestamps();
        });

        Schema::create('email_notification_settings', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('template_key')->unique();
            $table->boolean('enabled')->default(true);
            $table->string('category')->default('general');
            $table->string('name');
            $table->text('description')->nullable();
            $table->boolean('rate_limit_exempt')->default(false);
            $table->timestamps();
        });

        Schema::create('invoice_settings', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('company_name')->default('');
            $table->timestamps();
        });

        Schema::create('migrations', function (Blueprint $table): void {
            $table->increments('id');
            $table->string('migration');
            $table->integer('batch');
        });

        $migrationFiles = $this->app->make('migrator')->getMigrationFiles(database_path('migrations'));
        foreach (array_keys($migrationFiles) as $migration) {
            DB::table('migrations')->insert(['migration' => $migration, 'batch' => 1]);
        }

        $now = now();
        foreach (EggSeeder::$import as $name) {
            DB::table('nests')->insert([
                'uuid' => Str::uuid()->toString(),
                'author' => 'support@pterodactyl.io',
                'name' => $name,
                'description' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('migrations');
        Schema::dropIfExists('invoice_settings');
        Schema::dropIfExists('email_notification_settings');
        Schema::dropIfExists('webhook_events');
        Schema::dropIfExists('theme_presets');
        Schema::dropIfExists('egg_variables');
        Schema::dropIfExists('eggs');
        Schema::dropIfExists('nests');

        parent::tearDown();
    }

    public function testEggReseedingAddsMissingEggsAndPreservesExistingEggsNonInteractively(): void
    {
        $this->seedEggs();
        $total = Egg::query()->count();

        Egg::query()->where('name', 'Bungeecord')->update(['description' => 'My custom definition']);
        Egg::query()->where('name', 'Rust')->delete();

        $status = Artisan::call('db:seed', [
            '--class' => EggSeeder::class,
            '--force' => true,
            '--no-interaction' => true,
        ]);

        $this->assertSame(0, $status);
        $output = Artisan::output();
        $this->assertStringContainsString(
            sprintf('Added 1 missing egg; found %d existing eggs.', $total - 1),
            $output,
        );
        $this->assertStringContainsString(
            sprintf('Preserved %d existing eggs.', $total - 1),
            $output,
        );
        $this->assertStringContainsString('Missing eggs added:', $output);
        $this->assertStringContainsString('  + Rust / Rust', $output);

        $this->assertSame($total, Egg::query()->count());
        $this->assertSame(
            'My custom definition',
            Egg::query()->where('name', 'Bungeecord')->value('description'),
        );
    }

    public function testEggReseedingOverwritesOnlyAfterConfirmation(): void
    {
        $this->seedEggs();
        $total = Egg::query()->count();

        Egg::query()->where('name', 'Bungeecord')->update(['description' => 'My custom definition']);

        $this->artisan('db:seed', ['--class' => EggSeeder::class, '--force' => true])
            ->expectsConfirmation(
                sprintf(
                    'Would you like to overwrite the %d existing eggs with the shipped definitions? This will replace any custom changes.',
                    $total,
                ),
                'yes',
            )
            ->expectsOutputToContain(sprintf('Overwrote %d existing eggs.', $total))
            ->assertSuccessful();

        $this->assertNotSame(
            'My custom definition',
            Egg::query()->where('name', 'Bungeecord')->value('description'),
        );
    }

    public function testThemeReseedingAddsMissingPresetsAndPreservesExistingPresetsNonInteractively(): void
    {
        $this->seedThemes();
        $total = DB::table('theme_presets')->count();

        DB::table('theme_presets')->where('name', 'M12Labs Blue')->update(['colors' => '{"custom":true}']);
        DB::table('theme_presets')->where('name', 'Iris Purple')->delete();

        $status = Artisan::call('db:seed', [
            '--class' => ThemePresetSeeder::class,
            '--force' => true,
            '--no-interaction' => true,
        ]);

        $this->assertSame(0, $status);
        $output = Artisan::output();
        $this->assertStringContainsString(
            sprintf(
                'Added 1 missing theme preset; found %d existing built-in theme presets.',
                $total - 1,
            ),
            $output,
        );
        $this->assertStringContainsString(
            sprintf('Preserved %d existing built-in theme presets.', $total - 1),
            $output,
        );
        $this->assertStringContainsString('Missing theme presets added:', $output);
        $this->assertStringContainsString('  + Iris Purple', $output);

        $this->assertSame($total, DB::table('theme_presets')->count());
        $this->assertSame(
            '{"custom":true}',
            DB::table('theme_presets')->where('name', 'M12Labs Blue')->value('colors'),
        );
    }

    public function testDatabaseSeederCollectsAllOverwriteQuestionsAtTheEnd(): void
    {
        $events = new SeedEventLog();

        $this->app->instance(NestSeeder::class, new RecordingSeeder($events, 'nest seeded'));
        $this->app->instance(EggSeeder::class, new RecordingEggSeeder($events));
        $this->app->instance(WebhookSeeder::class, new RecordingSeeder($events, 'webhooks seeded'));
        $this->app->instance(EmailNotificationSettingsSeeder::class, new RecordingSeeder($events, 'email settings seeded'));
        $this->app->instance(InvoiceSettingsSeeder::class, new RecordingSeeder($events, 'invoice settings seeded'));
        $this->app->instance(ThemePresetSeeder::class, new RecordingThemePresetSeeder($events));

        $command = \Mockery::mock(Command::class)->shouldIgnoreMissing();
        $command->shouldReceive('getOutput')->andReturn(new BufferedOutput());

        $seeder = new DatabaseSeeder();
        $seeder->setContainer($this->app);
        $seeder->setCommand($command);
        $seeder->run();

        $this->assertSame([
            'nest seeded',
            'eggs scanned',
            'webhooks seeded',
            'email settings seeded',
            'invoice settings seeded',
            'theme presets scanned',
            'eggs question',
            'theme presets question',
            'eggs decision applied',
            'theme presets decision applied',
        ], $events->events);
    }

    public function testDatabaseSeederPrintsMissingItemsBeforeTheOverwriteReview(): void
    {
        $this->artisan('db:seed', [
            '--class' => DatabaseSeeder::class,
            '--force' => true,
            '--no-interaction' => true,
        ])->assertSuccessful();

        Egg::query()->where('name', 'Rust')->delete();
        DB::table('theme_presets')->where('name', 'Iris Purple')->delete();

        $status = Artisan::call('db:seed', [
            '--class' => DatabaseSeeder::class,
            '--force' => true,
            '--no-interaction' => true,
        ]);

        $this->assertSame(0, $status);
        $output = Artisan::output();

        $this->assertStringContainsString('Missing eggs added:', $output);
        $this->assertStringContainsString('  + Rust / Rust', $output);
        $this->assertStringContainsString('Missing theme presets added:', $output);
        $this->assertStringContainsString('  + Iris Purple', $output);

        $themeSummaryPosition = strpos($output, 'Added 1 missing theme preset;');
        $overwriteReviewPosition = strpos($output, 'Overwrite Review');
        $eggDecisionPosition = strpos($output, 'Preserved 14 existing eggs.');

        $this->assertIsInt($themeSummaryPosition);
        $this->assertIsInt($overwriteReviewPosition);
        $this->assertIsInt($eggDecisionPosition);
        $this->assertTrue($themeSummaryPosition < $overwriteReviewPosition);
        $this->assertTrue($overwriteReviewPosition < $eggDecisionPosition);
    }

    private function seedEggs(): void
    {
        $this->artisan('db:seed', [
            '--class' => EggSeeder::class,
            '--force' => true,
            '--no-interaction' => true,
        ])->assertSuccessful();
    }

    private function seedThemes(): void
    {
        $this->artisan('db:seed', [
            '--class' => ThemePresetSeeder::class,
            '--force' => true,
            '--no-interaction' => true,
        ])->assertSuccessful();
    }
}

class SeedEventLog
{
    /**
     * @var list<string>
     */
    public array $events = [];
}

class RecordingSeeder extends Seeder
{
    public function __construct(
        private SeedEventLog $events,
        private string $event,
    ) {
    }

    public function run(): void
    {
        $this->events->events[] = $this->event;
    }
}

class RecordingEggSeeder extends EggSeeder
{
    public function __construct(private SeedEventLog $events)
    {
    }

    public function __invoke(array $parameters = []): void
    {
        if (($parameters['deferOverwrite'] ?? false) !== true) {
            throw new \LogicException('Egg overwrite prompt was not deferred.');
        }

        $this->events->events[] = 'eggs scanned';
    }

    public function hasExistingRecords(): bool
    {
        return true;
    }

    public function confirmOverwrite(): bool
    {
        $this->events->events[] = 'eggs question';

        return false;
    }

    public function applyOverwrite(bool $overwrite): void
    {
        $this->events->events[] = 'eggs decision applied';
    }
}

class RecordingThemePresetSeeder extends ThemePresetSeeder
{
    public function __construct(private SeedEventLog $events)
    {
    }

    public function __invoke(array $parameters = []): void
    {
        if (($parameters['deferOverwrite'] ?? false) !== true) {
            throw new \LogicException('Theme preset overwrite prompt was not deferred.');
        }

        $this->events->events[] = 'theme presets scanned';
    }

    public function hasExistingRecords(): bool
    {
        return true;
    }

    public function confirmOverwrite(): bool
    {
        $this->events->events[] = 'theme presets question';

        return false;
    }

    public function applyOverwrite(bool $overwrite): void
    {
        $this->events->events[] = 'theme presets decision applied';
    }
}
