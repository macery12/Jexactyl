<?php

namespace Everest\Services\Extensions;

use Everest\Models\ExtensionRepository;

class ExtensionRepositoryBootstrapService
{
    public const OFFICIAL_REPOSITORY_SLUG = 'm12labs-official';
    private const OFFICIAL_REPOSITORY_NAME = 'M12Labs Official Repository';
    private const OFFICIAL_REPOSITORY_HOMEPAGE = 'https://github.com/macery12/M12Labs-Extensions';
    private const OFFICIAL_REPOSITORY_MANIFEST_URL = 'https://raw.githubusercontent.com/macery12/M12Labs-Extensions/refs/heads/main/registry.json';

    public function ensureOfficialRepository(): ExtensionRepository
    {
        $repository = ExtensionRepository::query()->firstOrNew([
            'slug' => self::OFFICIAL_REPOSITORY_SLUG,
        ]);

        $repository->name = self::OFFICIAL_REPOSITORY_NAME;
        $repository->manifest_url = $this->getOfficialManifestUrl();
        $repository->homepage_url = self::OFFICIAL_REPOSITORY_HOMEPAGE;
        $repository->is_official = true;

        if (!$repository->exists) {
            $repository->enabled = true;
        }

        if ($repository->risk_acknowledged_at === null) {
            $repository->risk_acknowledged_at = now();
        }

        $repository->save();

        return $repository->refresh();
    }

    private function getOfficialManifestUrl(): string
    {
        $override = config('modules.extensions.official_manifest_url');
        if (!empty($override)) {
            return (string) $override;
        }

        return self::OFFICIAL_REPOSITORY_MANIFEST_URL;
    }
}
