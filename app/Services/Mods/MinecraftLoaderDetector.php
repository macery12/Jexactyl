<?php

namespace Everest\Services\Mods;

/**
 * Identify the Minecraft implementation represented by an egg name.
 *
 * Loader detection is core panel behaviour: the mods API and AI diagnostics
 * must keep working when the optional startup-editor extension is absent.
 */
class MinecraftLoaderDetector
{
    /** @var array<string, string[]> More specific names must come first. */
    private const IMPLEMENTATIONS = [
        'neoforge' => ['neoforge', 'neo forge'],
        'minecraftforge' => ['minecraft forge'],
        'forge' => ['forge'],
        'fabric' => ['fabric'],
        'quilt' => ['quilt'],
        'folia' => ['folia'],
        'purpur' => ['purpur'],
        'paper' => ['paper'],
        'spigot' => ['spigot'],
        'bukkit' => ['craftbukkit', 'bukkit'],
        'velocity' => ['velocity'],
        'waterfall' => ['waterfall'],
        'bungeecord' => ['bungeecord', 'bungee cord'],
        'sponge' => ['sponge'],
    ];

    public function detect(string $eggName): ?string
    {
        $normalized = mb_strtolower(trim($eggName));
        $normalized = preg_replace('/[^a-z0-9]+/', ' ', $normalized) ?? $normalized;
        $normalized = ' ' . trim($normalized) . ' ';

        foreach (self::IMPLEMENTATIONS as $implementation => $aliases) {
            foreach ($aliases as $alias) {
                if (str_contains($normalized, ' ' . $alias . ' ')) {
                    return $implementation === 'minecraftforge' ? 'forge' : $implementation;
                }
            }
        }

        return null;
    }
}
