<?php

namespace Everest\Services\Plugins\Adapters;

use Everest\Services\Mods\ModrinthService;
use Everest\Services\Plugins\ProviderAdapterInterface;

class ModrinthProviderAdapter implements ProviderAdapterInterface
{
    public function __construct(private ModrinthService $modrinthService)
    {
    }

    public function search(array $params = []): array
    {
        return $this->modrinthService->searchMods($params);
    }

    public function getProject(string|int $projectId): array
    {
        return $this->modrinthService->getMod((string) $projectId);
    }

    public function listVersions(string|int $projectId, array $params = []): array
    {
        return $this->modrinthService->getModFiles((string) $projectId, $params);
    }

    public function getDownloadUrl(string|int $projectId, string|int $versionId): array
    {
        $downloadUrl = $this->modrinthService->getDownloadUrl((string) $versionId);

        $path = parse_url($downloadUrl, PHP_URL_PATH);
        $guessedName = $path ? basename($path) : null;
        $project = $this->modrinthService->getMod((string) $projectId);

        return [
            'url' => $downloadUrl,
            'fileName' => $guessedName ?: 'mod_' . $versionId . '.jar',
            'fileSize' => null,
            'projectName' => $project['title'] ?? $project['name'] ?? null,
            'versionName' => null,
        ];
    }
}
