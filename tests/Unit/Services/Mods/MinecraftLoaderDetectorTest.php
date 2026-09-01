<?php

namespace Everest\Tests\Unit\Services\Mods;

use Everest\Tests\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Services\Mods\MinecraftLoaderDetector;

class MinecraftLoaderDetectorTest extends TestCase
{
    #[DataProvider('eggNames')]
    public function testItDetectsKnownMinecraftEggNames(string $eggName, ?string $expected): void
    {
        $this->assertSame($expected, app(MinecraftLoaderDetector::class)->detect($eggName));
    }

    public static function eggNames(): array
    {
        return [
            ['NeoForge 1.20.1', 'neoforge'],
            ['Minecraft Forge', 'forge'],
            ['Fabric - Generic', 'fabric'],
            ['Paper', 'paper'],
            ['Bungee Cord Proxy', 'bungeecord'],
            ['Velocity Proxy', 'velocity'],
            ['Generic Java', null],
            ['', null],
        ];
    }
}
