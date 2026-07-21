<?php

namespace Everest\Services\Mods;

use Everest\Exceptions\Service\Mods\ModsServiceException;

/**
 * Builds an install preview for a modpack file using the CurseForge API only —
 * no zip download or manifest parsing. The install itself runs entirely on the
 * Wings node (see InstallModpackJob), so the preview's only job now is to surface
 * the pack's name/version and its loader + Minecraft version for the wizard's
 * mismatch / egg-swap step.
 */
class ModpackPreviewService
{
    /** CurseForge encodes loaders as gameVersions strings alongside MC versions. */
    private const LOADER_NAMES = ['forge', 'neoforge', 'fabric', 'quilt'];

    public function __construct(private CurseForgeService $curseForge) {}

    /**
     * @throws ModsServiceException
     */
    public function preview(int $projectId, int $fileId): array
    {
        $file = $this->curseForge->getModpackFile($projectId, $fileId);

        if (empty($file['downloadUrl'])) {
            throw new ModsServiceException('This modpack file cannot be downloaded (distribution disabled by the author).');
        }

        [$loader, $minecraftVersion] = $this->parseGameVersions($file['gameVersions'] ?? []);

        // Pack name comes from the project; fall back to the file display name.
        $modpackName = $file['displayName'] ?? ($file['fileName'] ?? '');
        try {
            $project     = $this->curseForge->getModpack($projectId);
            $modpackName = $project['data']['name'] ?? $modpackName;
        } catch (\Exception) {
            // Non-fatal — keep the file display name.
        }

        return [
            'modpack_name'      => $modpackName,
            'modpack_version'   => $file['displayName'] ?? ($file['fileName'] ?? ''),
            'minecraft_version' => $minecraftVersion,
            'loader'            => $loader,
            // Exact loader version lives only in the pack manifest, which we no
            // longer download. The egg swap falls back to the egg's default.
            'loader_version'    => null,
        ];
    }

    /**
     * Split a CurseForge gameVersions array into [loaderSlug, minecraftVersion].
     *
     * @param string[] $gameVersions
     * @return array{0: ?string, 1: ?string}
     */
    private function parseGameVersions(array $gameVersions): array
    {
        $loader  = null;
        $version = null;

        foreach ($gameVersions as $gv) {
            $lower = strtolower((string) $gv);
            if ($loader === null && in_array($lower, self::LOADER_NAMES, true)) {
                $loader = $lower;
            } elseif ($version === null && preg_match('/^\d+\.\d+(\.\d+)?$/', (string) $gv)) {
                $version = (string) $gv;
            }
        }

        return [$loader, $version];
    }
}
