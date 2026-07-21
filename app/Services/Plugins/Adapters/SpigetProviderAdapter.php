<?php

namespace Everest\Services\Plugins\Adapters;

use Everest\Models\Setting;
use Everest\Services\Mods\SpigetService;
use Everest\Services\Plugins\ProviderAdapterInterface;
use Everest\Exceptions\Service\Mods\ModsServiceException;

class SpigetProviderAdapter implements ProviderAdapterInterface
{
    public function __construct(private SpigetService $spigetService)
    {
    }

    /**
     * {@inheritdoc}
     */
    public function search(array $params = []): array
    {
        return $this->spigetService->searchMods($params);
    }

    /**
     * {@inheritdoc}
     */
    public function getProject(string|int $projectId): array
    {
        return $this->spigetService->getMod($projectId);
    }

    /**
     * {@inheritdoc}
     */
    public function listVersions(string|int $projectId, array $params = []): array
    {
        return $this->spigetService->getModFiles($projectId, $params);
    }

    /**
     * {@inheritdoc}
     */
    public function getDownloadUrl(string|int $projectId, string|int $versionId): array
    {
        $project = $this->spigetService->getMod($projectId);
        if (isset($project['data'])) {
            $project = $project['data'];
        }
        if ($project['isPremium'] ?? false) {
            throw new ModsServiceException('Premium resources cannot be downloaded via the panel.');
        }

        if ($project['isExternal'] ?? false) {
            $allowed = (bool) Setting::get(
                'settings::modules:mods:allow_external_downloads',
                config('modules.mods.allow_external_downloads', false)
            );
            if (!$allowed) {
                throw new ModsServiceException('External Spigot resources must be downloaded manually. An administrator can enable external downloads in Marketplace Settings.');
            }
        }

        $files = $this->spigetService->getModFiles($projectId, [
            'index' => 0,
            'pageSize' => 10,
        ]);

        $versions = $files['data'] ?? [];
        $version = collect($versions)->firstWhere('id', (int) $versionId) ?? ($versions[0] ?? []);
        if (isset($version['data'])) {
            $version = $version['data'];
        }

        $projectName = $project['name'] ?? ($project['title'] ?? null);
        if (!$projectName && isset($project['slug'])) {
            $projectName = $project['slug'];
        }
        $versionName = $version['displayName'] ?? $version['name'] ?? null;
        if (!$versionName && isset($version['fileName'])) {
            // Extract filename (without extension) to use as the version label so install filenames include both project and version identifiers.
            $versionName = pathinfo($version['fileName'], PATHINFO_FILENAME);
        }

        return [
            'url' => $this->spigetService->getDownloadUrl($projectId, $versionId)['url'],
            'fileName' => $version['fileName'] ?? 'plugin_' . $versionId . '.jar',
            'fileSize' => $version['fileLength'] ?? ($version['size'] ?? null),
            'projectName' => $projectName,
            'versionName' => $versionName,
        ];
    }
}
