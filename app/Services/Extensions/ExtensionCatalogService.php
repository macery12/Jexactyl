<?php

namespace Everest\Services\Extensions;

use GuzzleHttp\Psr7\Utils;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;
use GuzzleHttp\Psr7\UriResolver;
use Everest\Models\ExtensionConfig;
use Everest\Models\ExtensionPackage;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Everest\Models\ExtensionRepository;
use Everest\Exceptions\DisplayException;

class ExtensionCatalogService
{
    public function __construct(
        private ExtensionRepositoryBootstrapService $bootstrapService,
        private ExtensionMigrationService $migrationService,
        private ExtensionPackageArtifactService $artifactService,
    ) {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getLocalExtensions(): array
    {
        $configs = ExtensionConfig::query()->get()->keyBy('extension_id');
        $extensions = [];

        foreach ((array) config('modules.extensions.available', []) as $extensionId => $definition) {
            if (!is_array($definition)) {
                continue;
            }

            $config = $configs->get($extensionId);
            $extensions[$extensionId] = [
                'id' => $extensionId,
                'name' => $definition['name'] ?? $extensionId,
                'description' => $definition['description'] ?? '',
                'version' => $definition['version'] ?? '1.0.0',
                'latestVersion' => $definition['version'] ?? '1.0.0',
                'author' => $definition['author'] ?? 'M12Labs',
                'icon' => $definition['icon'] ?? 'puzzle',
                'route' => $definition['route'] ?? $extensionId,
                'hasServerPage' => true,
                'admin' => null,
                'type' => 'user',
                'enabled' => (bool) ($config?->enabled ?? false),
                'allowedNests' => array_values($config?->allowed_nests ?? $definition['allowed_nests'] ?? []),
                'allowedEggs' => array_values($config?->allowed_eggs ?? $definition['allowed_eggs'] ?? []),
                'settings' => is_array($config?->settings) ? $config->settings : [],
                'settingsSchema' => $this->normalizeSettingsSchema($definition['settings_schema'] ?? []),
                'installed' => true,
                'installable' => false,
                'canUninstall' => false,
                'hasDatabase' => false,
                'status' => 'core',
                'updateAvailable' => false,
                // Core + already-installed extensions are never gated on
                // compatibility — they're on disk and running.
                'compatible' => true,
                'compatiblePanelVersions' => [],
                'source' => [
                    'type' => 'core',
                    'label' => 'Core',
                    'official' => true,
                    'repositoryId' => null,
                    'repositoryName' => 'Core',
                    'homepageUrl' => null,
                    'securityWarning' => 'Core extensions ship with M12Labs itself and are not removed through the repository installer.',
                ],
            ];
        }

        $packages = ExtensionPackage::query()->with('repository')->get();
        foreach ($packages as $package) {
            $config = $configs->get($package->extension_id);
            $manifest = is_array($package->manifest) ? $package->manifest : [];
            $extension = (array) Arr::get($manifest, 'extension', []);
            $repository = $package->repository;

            // Admin-only extensions declare "route": null in their manifest; the
            // server gallery skips them and the admin drawer hides nest/egg scoping.
            $hasServerPage = Arr::get($extension, 'route', $package->route ?: $package->extension_id) !== null;
            $adminSurface = Arr::get($extension, 'admin');

            $extensions[$package->extension_id] = [
                'id' => $package->extension_id,
                'name' => $package->name,
                'description' => $package->description ?? '',
                'version' => $package->installed_version,
                'latestVersion' => $package->installed_version,
                'author' => $package->author ?? 'M12Labs',
                'icon' => $package->icon ?: 'puzzle',
                'route' => $package->route ?: $package->extension_id,
                'hasServerPage' => $hasServerPage,
                'admin' => $adminSurface,
                'type' => $this->deriveExtensionType($hasServerPage, $adminSurface),
                'enabled' => (bool) ($config?->enabled ?? false),
                'allowedNests' => array_values($config?->allowed_nests ?? Arr::get($extension, 'defaults.allowedNests', [])),
                'allowedEggs' => array_values($config?->allowed_eggs ?? Arr::get($extension, 'defaults.allowedEggs', [])),
                'settings' => is_array($config?->settings)
                    ? $config->settings
                    : (array) Arr::get($extension, 'defaults.settings', []),
                'settingsSchema' => $this->normalizeSettingsSchema(Arr::get($extension, 'settingsSchema', [])),
                'installed' => true,
                'installable' => false,
                'canUninstall' => true,
                // Whether this package ships a database (migrations). Drives
                // whether the uninstall UI offers the drop-tables option, so the
                // operator is never asked about data an extension never created.
                'hasDatabase' => $this->migrationService->hasMigrations($package->extension_id),
                'status' => 'installed',
                'updateAvailable' => false,
                // Installed packages (including manual uploads that may sit outside
                // the declared range) are already on disk and never blocked.
                'compatible' => true,
                'compatiblePanelVersions' => array_values(array_filter((array) Arr::get($manifest, 'compatiblePanelVersions', []), 'is_string')),
                'source' => [
                    'type' => 'repository',
                    'label' => $package->source_repository_name ?: ($repository?->name ?? 'Custom repository'),
                    'official' => (bool) $repository?->is_official,
                    'repositoryId' => $repository?->id,
                    'repositoryName' => $package->source_repository_name ?: $repository?->name,
                    'homepageUrl' => $repository?->homepage_url,
                    'securityWarning' => $this->getRepositorySecurityWarning($repository),
                ],
            ];
        }

        ksort($extensions);

        return array_values($extensions);
    }

    /**
     * @return array{extensions: array<int, array<string, mixed>>, repositories: array<int, array<string, mixed>>}
     */
    public function getCatalog(bool $forceRefresh = false): array
    {
        $this->bootstrapService->ensureOfficialRepository();

        $localExtensions = [];
        foreach ($this->getLocalExtensions() as $extension) {
            $localExtensions[$extension['id']] = $extension;
        }

        $configs = ExtensionConfig::query()->get()->keyBy('extension_id');
        $repositories = [];

        foreach (ExtensionRepository::query()->orderByDesc('is_official')->orderBy('name')->get() as $repository) {
            $repositorySummary = $this->formatRepositorySummary($repository);

            if (!$repository->enabled) {
                $repositorySummary['status'] = 'disabled';
                $repositories[] = $repositorySummary;

                continue;
            }

            try {
                $manifest = $this->fetchRepositoryManifest($repository, $forceRefresh);
                $packages = $manifest['packages'] ?? [];

                $repositorySummary['status'] = 'ok';
                $repositorySummary['packagesCount'] = count($packages);

                foreach ($packages as $package) {
                    $extensionId = $package['id'];
                    // Surface the newest release the running panel can actually
                    // install — not just the newest overall. A package may ship
                    // (e.g.) a 2.0.0 for the current panel and an older 1.0.0 for
                    // a previous one; picking blindly by recency would flag the
                    // whole extension incompatible whenever the newest build
                    // targets a different panel version.
                    $latestRelease = $this->selectInstallableRelease($package['versions']);
                    $config = $configs->get($extensionId);

                    if (isset($localExtensions[$extensionId])) {
                        $localExtensions[$extensionId]['latestVersion'] = $latestRelease['version'];
                        $localExtensions[$extensionId]['compatiblePanelVersions'] = $latestRelease['compatiblePanelVersions'];
                        // Only offer an update when the repository release is
                        // strictly NEWER than what's installed. A plain `!==`
                        // check mis-fires when a manually installed build is ahead
                        // of the repo (e.g. local 2.0.0 vs published 1.0.0) and
                        // would otherwise advertise a downgrade as an "update".
                        $localExtensions[$extensionId]['updateAvailable'] =
                            in_array($localExtensions[$extensionId]['status'], ['installed', 'core'], true)
                            && version_compare(
                                (string) $latestRelease['version'],
                                (string) $localExtensions[$extensionId]['version'],
                                '>'
                            );

                        if ($this->shouldMirrorCoreExtensionFromRepository($localExtensions[$extensionId], $repository)) {
                            $localExtensions[$extensionId] = $this->mirrorCoreExtensionFromRepository(
                                $localExtensions[$extensionId],
                                $repository
                            );
                        }

                        continue;
                    }

                    $localExtensions[$extensionId] = [
                        'id' => $extensionId,
                        'name' => $package['name'],
                        'description' => $package['description'],
                        'version' => $latestRelease['version'],
                        'latestVersion' => $latestRelease['version'],
                        'author' => $package['author'],
                        'icon' => $package['icon'],
                        'route' => $package['route'],
                        'hasServerPage' => $package['hasServerPage'] ?? true,
                        'admin' => $package['admin'] ?? null,
                        'type' => $this->deriveExtensionType($package['hasServerPage'] ?? true, $package['admin'] ?? null),
                        'enabled' => false,
                        'allowedNests' => array_values($config?->allowed_nests ?? []),
                        'allowedEggs' => array_values($config?->allowed_eggs ?? []),
                        'settings' => is_array($config?->settings) ? $config->settings : [],
                        'settingsSchema' => $this->normalizeSettingsSchema($package['settingsSchema'] ?? []),
                        'installed' => false,
                        'installable' => true,
                        'canUninstall' => false,
                        'hasDatabase' => false,
                        'status' => 'available',
                        'updateAvailable' => false,
                        // A repository fetch is gated on the panel version: an
                        // incompatible release surfaces as "incompatible" and the
                        // install button is blocked (the install service enforces
                        // the same rule server-side).
                        'compatible' => $this->artifactService->isCompatiblePanelVersions($latestRelease['compatiblePanelVersions'] ?? []),
                        'compatiblePanelVersions' => $latestRelease['compatiblePanelVersions'],
                        'source' => [
                            'type' => 'repository',
                            'label' => $repository->name,
                            'official' => $repository->is_official,
                            'repositoryId' => $repository->id,
                            'repositoryName' => $repository->name,
                            'homepageUrl' => $repository->homepage_url,
                            'securityWarning' => $this->getRepositorySecurityWarning($repository),
                        ],
                    ];
                }
            } catch (\Throwable $exception) {
                report($exception);

                $repositorySummary['status'] = 'error';
                $repositorySummary['error'] = $exception->getMessage();
            }

            $repositories[] = $repositorySummary;
        }

        ksort($localExtensions);

        return [
            'extensions' => array_values($localExtensions),
            'repositories' => $repositories,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getExtension(string $extensionId, bool $forceRefresh = false): ?array
    {
        foreach ($this->getCatalog($forceRefresh)['extensions'] as $extension) {
            if ($extension['id'] === $extensionId) {
                return $extension;
            }
        }

        return null;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getRepositories(bool $forceRefresh = false): array
    {
        return $this->getCatalog($forceRefresh)['repositories'];
    }

    /**
     * @return array{id: string, name: string, description: string, author: string, icon: string, route: string, settingsSchema: array<int, array<string, mixed>>, latestRelease: array<string, mixed>, repository: ExtensionRepository}
     */
    public function findRepositoryPackage(string $extensionId, int $repositoryId, ?string $version = null): array
    {
        $this->bootstrapService->ensureOfficialRepository();

        $repository = ExtensionRepository::query()->findOrFail($repositoryId);
        $manifest = $this->fetchRepositoryManifest($repository, true);

        foreach ($manifest['packages'] ?? [] as $package) {
            if ($package['id'] !== $extensionId) {
                continue;
            }

            if ($version === null || $package['latestRelease']['version'] === $version) {
                $package['repository'] = $repository;

                return $package;
            }

            foreach ($package['versions'] as $release) {
                if ($release['version'] === $version) {
                    $package['latestRelease'] = $release;
                    $package['repository'] = $repository;

                    return $package;
                }
            }
        }

        throw new DisplayException('The selected extension could not be found in that repository.');
    }

    public function validateRepository(ExtensionRepository $repository): void
    {
        if (!$repository->enabled) {
            return;
        }

        $this->fetchRepositoryManifest($repository, true);
    }

    /**
     * @return array<string, mixed>
     */
    public function fetchRepositoryManifest(ExtensionRepository $repository, bool $forceRefresh = false): array
    {
        $cacheKey = sprintf(
            'extensions:repository:%s:%s',
            $repository->id,
            sha1($repository->manifest_url . '|' . $repository->updated_at?->timestamp)
        );

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, now()->addMinutes(5), function () use ($repository) {
            $payload = json_decode($this->readLocationContents($repository->manifest_url), true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($payload)) {
                throw new DisplayException(sprintf('Repository "%s" returned an invalid manifest.', $repository->name));
            }

            return $this->normalizeRepositoryManifest($payload, $repository);
        });
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    private function normalizeRepositoryManifest(array $payload, ExtensionRepository $repository): array
    {
        $packages = [];
        foreach ((array) ($payload['packages'] ?? []) as $package) {
            if (!is_array($package)) {
                continue;
            }

            $extensionId = trim((string) ($package['id'] ?? ''));
            if ($extensionId === '') {
                continue;
            }

            $versions = [];
            foreach ((array) ($package['versions'] ?? []) as $release) {
                if (!is_array($release)) {
                    continue;
                }

                $version = trim((string) ($release['version'] ?? ''));
                $archive = trim((string) ($release['archive'] ?? ''));
                $checksum = $this->normalizeChecksum((string) ($release['sha256'] ?? ''));

                if ($version === '' || $archive === '' || $checksum === '') {
                    continue;
                }

                $versions[] = [
                    'version' => $version,
                    'archiveUrl' => $this->resolveLocation($repository->manifest_url, $archive),
                    'archiveChecksum' => $checksum,
                    'publishedAt' => $release['publishedAt'] ?? null,
                    'compatiblePanelVersions' => array_values(array_filter((array) ($release['compatiblePanelVersions'] ?? []), 'is_string')),
                    'notes' => $release['notes'] ?? null,
                ];
            }

            if ($versions === []) {
                continue;
            }

            usort($versions, function (array $left, array $right): int {
                $leftPublishedAt = $left['publishedAt'] ?? '';
                $rightPublishedAt = $right['publishedAt'] ?? '';

                if ($leftPublishedAt !== '' || $rightPublishedAt !== '') {
                    return strcmp((string) $rightPublishedAt, (string) $leftPublishedAt);
                }

                return strcmp((string) $right['version'], (string) $left['version']);
            });

            $packages[] = [
                'id' => $extensionId,
                'name' => (string) ($package['name'] ?? $extensionId),
                'description' => (string) ($package['description'] ?? ''),
                'author' => (string) ($package['author'] ?? 'M12Labs'),
                'icon' => (string) ($package['icon'] ?? 'puzzle'),
                'route' => (string) ($package['route'] ?? $extensionId),
                // Surface hints for admin-only packages. Registries may declare a
                // "surfaces" list or a null "route"; absent either, assume a
                // server page (the classic v1 surface) for backwards compatibility.
                'hasServerPage' => isset($package['surfaces']) && is_array($package['surfaces'])
                    ? in_array('server', $package['surfaces'], true)
                    : (array_key_exists('route', $package) ? $package['route'] !== null : true),
                'admin' => $package['admin'] ?? null,
                'settingsSchema' => $this->normalizeSettingsSchema($package['settingsSchema'] ?? []),
                'versions' => $versions,
                'latestRelease' => $versions[0],
            ];
        }

        return [
            'schemaVersion' => (int) ($payload['schemaVersion'] ?? 1),
            'repository' => [
                'name' => (string) Arr::get($payload, 'repository.name', $repository->name),
                'homepage' => Arr::get($payload, 'repository.homepage', $repository->homepage_url),
            ],
            'packages' => $packages,
        ];
    }

    /**
     * Choose which repository release to surface for install/update. Releases
     * arrive newest-first (see the usort in normalizeRepositoryManifest); we
     * prefer the newest one the running panel can actually install. Only when
     * NO release is compatible do we fall back to the newest overall — the
     * extension then reads as "incompatible" and the install button is blocked,
     * listing that release's requirements.
     *
     * @param array<int, array<string, mixed>> $versions newest-first
     *
     * @return array<string, mixed>
     */
    private function selectInstallableRelease(array $versions): array
    {
        foreach ($versions as $release) {
            if ($this->artifactService->isCompatiblePanelVersions($release['compatiblePanelVersions'] ?? [])) {
                return $release;
            }
        }

        return $versions[0];
    }

    /**
     * Derive the extension's surface type from which surfaces it exposes.
     *
     * 'user'  — a per-server page only (the classic surface; nest/egg access
     *           scoping applies).
     * 'admin' — an admin page only; there is no per-server surface, so nest/egg
     *           access scoping is meaningless and is hidden in the UI.
     * 'both'  — exposes both surfaces.
     */
    private function deriveExtensionType(bool $hasServerPage, mixed $admin): string
    {
        $hasAdminPage = is_array($admin) && $admin !== [];

        if ($hasServerPage && $hasAdminPage) {
            return 'both';
        }

        return $hasAdminPage ? 'admin' : 'user';
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function normalizeSettingsSchema(mixed $schema): array
    {
        if (!is_array($schema)) {
            return [];
        }

        return array_values(array_filter($schema, function ($field): bool {
            return is_array($field)
                && !empty($field['key'])
                && !empty($field['label'])
                && !empty($field['type']);
        }));
    }

    /**
     * @return array<string, mixed>
     */
    private function formatRepositorySummary(ExtensionRepository $repository): array
    {
        return [
            'id' => $repository->id,
            'slug' => $repository->slug,
            'name' => $repository->name,
            'manifestUrl' => $repository->manifest_url,
            'homepageUrl' => $repository->homepage_url,
            'enabled' => $repository->enabled,
            'official' => $repository->is_official,
            'packagesCount' => 0,
            'securityWarning' => $this->getRepositorySecurityWarning($repository),
        ];
    }

    /**
     * @param array<string, mixed> $extension
     */
    private function shouldMirrorCoreExtensionFromRepository(array $extension, ExtensionRepository $repository): bool
    {
        return ($extension['status'] ?? null) === 'core' && $repository->is_official;
    }

    /**
     * @param array<string, mixed> $extension
     *
     * @return array<string, mixed>
     */
    private function mirrorCoreExtensionFromRepository(array $extension, ExtensionRepository $repository): array
    {
        $extension['status'] = 'installed';
        $extension['installed'] = true;
        $extension['installable'] = false;
        $extension['canUninstall'] = false;
        $extension['source'] = [
            'type' => 'repository',
            'label' => $repository->name,
            'official' => (bool) $repository->is_official,
            'repositoryId' => $repository->id,
            'repositoryName' => $repository->name,
            'homepageUrl' => $repository->homepage_url,
            'securityWarning' => $this->getRepositorySecurityWarning($repository),
        ];

        return $extension;
    }

    private function getRepositorySecurityWarning(?ExtensionRepository $repository): string
    {
        if ($repository?->is_official) {
            return 'Checksums verify that the downloaded archive matches the manifest published by the official M12Labs repository.';
        }

        return 'Third-party repositories can ship arbitrary PHP and frontend code into M12Labs. Checksums only verify the archive matches that repository manifest.';
    }

    private function readLocationContents(string $location): string
    {
        if ($this->isHttpLocation($location)) {
            $response = Http::timeout(30)->get($location);
            if (!$response->successful()) {
                throw new DisplayException(sprintf('Unable to fetch repository manifest from "%s".', $location));
            }

            return (string) $response->body();
        }

        $path = $this->toLocalPath($location);
        if (!is_file($path)) {
            throw new DisplayException(sprintf('Repository manifest "%s" does not exist on disk.', $path));
        }

        return File::get($path);
    }

    private function resolveLocation(string $baseLocation, string $path): string
    {
        if ($path === '') {
            return $path;
        }

        if ($this->isHttpLocation($path) || Str::startsWith($path, 'file://') || Str::startsWith($path, '/')) {
            return $path;
        }

        if ($this->isHttpLocation($baseLocation)) {
            return (string) UriResolver::resolve(Utils::uriFor($baseLocation), Utils::uriFor($path));
        }

        return dirname($this->toLocalPath($baseLocation)) . '/' . ltrim($path, '/');
    }

    private function normalizeChecksum(string $checksum): string
    {
        $checksum = strtolower(trim($checksum));

        return Str::startsWith($checksum, 'sha256:') ? substr($checksum, 7) : $checksum;
    }

    private function isHttpLocation(string $location): bool
    {
        return Str::startsWith($location, ['http://', 'https://']);
    }

    private function toLocalPath(string $location): string
    {
        if (Str::startsWith($location, 'file://')) {
            return rawurldecode(substr($location, 7));
        }

        return $location;
    }
}
