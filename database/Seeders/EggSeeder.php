<?php

namespace Database\Seeders;

use Everest\Models\Egg;
use Everest\Models\Nest;
use Illuminate\Support\Str;
use Illuminate\Database\Seeder;
use Illuminate\Http\UploadedFile;
use Everest\Services\Eggs\Sharing\EggImporterService;
use Everest\Services\Eggs\Sharing\EggUpdateImporterService;

class EggSeeder extends Seeder
{
    /**
     * @var list<array{Egg, string, string}>
     */
    private array $existing = [];

    /**
     * @var string[]
     */
    public static array $import = [
        'Minecraft',
        'Source Engine',
        'Voice Servers',
        'Rust',
    ];

    /**
     * EggSeeder constructor.
     */
    public function __construct(
        private EggImporterService $importerService,
        private EggUpdateImporterService $updateImporterService,
    ) {
    }

    /**
     * Run the egg seeder.
     *
     * @throws \JsonException
     */
    public function run(bool $deferOverwrite = false)
    {
        $this->existing = [];
        $created = [];

        foreach (static::$import as $nest) {
            /* @noinspection PhpParamsInspection */
            [$createdInNest, $existingInNest] = $this->parseEggFiles(
                Nest::query()->where('author', 'support@pterodactyl.io')->where('name', $nest)->firstOrFail()
            );

            array_push($created, ...$createdInNest);
            array_push($this->existing, ...$existingInNest);
        }

        $duplicateCount = count($this->existing);

        $this->command->info(sprintf(
            'Added %d missing %s; found %d existing %s.',
            count($created),
            Str::plural('egg', count($created)),
            $duplicateCount,
            Str::plural('egg', $duplicateCount),
        ));

        if ($created !== []) {
            $this->command->comment('Missing eggs added:');
            foreach ($created as $name) {
                $this->command->line('  + ' . $name);
            }
        }

        if ($deferOverwrite || $duplicateCount === 0) {
            return;
        }

        $this->applyOverwrite($this->confirmOverwrite());
    }

    public function hasExistingRecords(): bool
    {
        return $this->existing !== [];
    }

    public function confirmOverwrite(): bool
    {
        $duplicateCount = count($this->existing);

        if ($duplicateCount === 0) {
            return false;
        }

        return $this->command->confirm(
            sprintf(
                'Would you like to overwrite the %d existing %s with the shipped definitions? This will replace any custom changes.',
                $duplicateCount,
                Str::plural('egg', $duplicateCount),
            ),
            false,
        );
    }

    public function applyOverwrite(bool $overwrite): void
    {
        $duplicateCount = count($this->existing);

        if ($duplicateCount === 0) {
            return;
        }

        if (!$overwrite) {
            $this->command->comment(sprintf(
                'Preserved %d existing %s.',
                $duplicateCount,
                Str::plural('egg', $duplicateCount),
            ));

            return;
        }

        foreach ($this->existing as [$egg, $path, $name]) {
            $file = new UploadedFile($path, basename($path), 'application/json');
            $this->updateImporterService->handle($egg, $file);
            $this->command->info('Updated ' . $name);
        }

        $this->command->info(sprintf(
            'Overwrote %d existing %s.',
            $duplicateCount,
            Str::plural('egg', $duplicateCount),
        ));
    }

    /**
     * Loop through the list of egg files and import them.
     *
     * @return array{list<string>, list<array{Egg, string, string}>}
     *
     * @throws \JsonException
     */
    protected function parseEggFiles(Nest $nest): array
    {
        $files = new \DirectoryIterator(database_path('Seeders/eggs/' . Str::kebab($nest->name)));
        $created = [];
        $existing = [];

        /** @var \DirectoryIterator $file */
        foreach ($files as $file) {
            if (!$file->isFile() || !$file->isReadable()) {
                continue;
            }

            $path = $file->getPathname();
            $decoded = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

            $egg = $nest->eggs()
                ->where('author', $decoded['author'])
                ->where('name', $decoded['name'])
                ->first();

            if ($egg instanceof Egg) {
                $existing[] = [$egg, $path, $decoded['name']];
            } else {
                $upload = new UploadedFile($path, $file->getFilename(), 'application/json');
                $this->importerService->handleFile($nest->id, $upload);
                $created[] = $nest->name . ' / ' . $decoded['name'];
            }
        }

        return [$created, $existing];
    }
}
