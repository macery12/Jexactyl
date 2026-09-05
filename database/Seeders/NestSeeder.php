<?php

namespace Database\Seeders;

use Illuminate\Support\Str;
use Illuminate\Database\Seeder;
use Everest\Services\Nests\NestCreationService;
use Everest\Contracts\Repository\NestRepositoryInterface;

class NestSeeder extends Seeder
{
    /**
     * @var NestCreationService
     */
    private $creationService;

    /**
     * @var NestRepositoryInterface
     */
    private $repository;

    /**
     * NestSeeder constructor.
     */
    public function __construct(
        NestCreationService $creationService,
        NestRepositoryInterface $repository,
    ) {
        $this->creationService = $creationService;
        $this->repository = $repository;
    }

    /**
     * Run the seeder to add missing nests to the Panel.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    public function run()
    {
        $items = $this->repository->findWhere([
            'author' => 'support@pterodactyl.io',
        ])->keyBy('name')->toArray();

        $created = [];

        if ($this->createMinecraftNest(array_get($items, 'Minecraft'))) {
            $created[] = 'Minecraft';
        }
        if ($this->createSourceEngineNest(array_get($items, 'Source Engine'))) {
            $created[] = 'Source Engine';
        }
        if ($this->createVoiceServersNest(array_get($items, 'Voice Servers'))) {
            $created[] = 'Voice Servers';
        }
        if ($this->createRustNest(array_get($items, 'Rust'))) {
            $created[] = 'Rust';
        }

        $this->command->info(sprintf(
            'Added %d missing %s; found %d existing %s.',
            count($created),
            Str::plural('nest', count($created)),
            4 - count($created),
            Str::plural('nest', 4 - count($created)),
        ));

        if ($created !== []) {
            $this->command->comment('Missing nests added:');
            foreach ($created as $name) {
                $this->command->line('  + ' . $name);
            }
        }
    }

    /**
     * Create the Minecraft nest to be used later on.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    private function createMinecraftNest(?array $nest = null): bool
    {
        if (is_null($nest)) {
            $this->creationService->handle([
                'name' => 'Minecraft',
                'description' => 'Minecraft - the classic game from Mojang. With support for Vanilla MC, Spigot, and many others!',
            ], 'support@pterodactyl.io');

            return true;
        }

        return false;
    }

    /**
     * Create the Source Engine Games nest to be used later on.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    private function createSourceEngineNest(?array $nest = null): bool
    {
        if (is_null($nest)) {
            $this->creationService->handle([
                'name' => 'Source Engine',
                'description' => 'Includes support for most Source Dedicated Server games.',
            ], 'support@pterodactyl.io');

            return true;
        }

        return false;
    }

    /**
     * Create the Voice Servers nest to be used later on.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    private function createVoiceServersNest(?array $nest = null): bool
    {
        if (is_null($nest)) {
            $this->creationService->handle([
                'name' => 'Voice Servers',
                'description' => 'Voice servers such as Mumble and Teamspeak 3.',
            ], 'support@pterodactyl.io');

            return true;
        }

        return false;
    }

    /**
     * Create the Rust nest to be used later on.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    private function createRustNest(?array $nest = null): bool
    {
        if (is_null($nest)) {
            $this->creationService->handle([
                'name' => 'Rust',
                'description' => 'Rust - A game where you must fight to survive.',
            ], 'support@pterodactyl.io');

            return true;
        }

        return false;
    }
}
