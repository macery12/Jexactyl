<?php

namespace Everest\Services\Plugins;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Everest\Models\Setting;
use Everest\Models\Server;
use Everest\Models\Billing\Product;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Services\Plugins\Adapters\SpigetProviderAdapter;
use Everest\Services\Plugins\Adapters\ModrinthProviderAdapter;
use Everest\Exceptions\Service\Mods\ModsServiceException;
use Everest\Models\MarketplaceInstallLog;

class PluginInstallService
{
    private array $adapters;
    private array $allowedExtensions = [
        'mod' => ['jar', 'zip'],
        'plugin' => ['jar'],
    ];
    private const DEFAULT_MAX_PLUGIN_SIZE = 104857600; // 100MB
    private const DEFAULT_MAX_MOD_SIZE = 157286400; // 150MB
    private const BODY_PREVIEW_MAX_BYTES = 8192;
    private const BODY_PREVIEW_READ_BYTES = 512;

    public function __construct(
        ModrinthProviderAdapter $modrinthProviderAdapter,
        SpigetProviderAdapter $spigetProviderAdapter,
        private DaemonFileRepository $fileRepository
    ) {
        $this->adapters = [
            'modrinth' => $modrinthProviderAdapter,
            'spiget' => $spigetProviderAdapter,
            'spigot' => $spigetProviderAdapter,
        ];
    }

    /**
     * Install an addon/plugin from a provider.
     *
     * @throws ModsServiceException
     */
    public function installFromProvider(Server $server, string $provider, string $type, string|int $projectId, string|int $versionId, ?int $userId = null): array
    {
        $providerKey = strtolower($provider);
        $adapter = $this->adapters[$providerKey] ?? null;

        if (!$adapter) {
            throw new ModsServiceException('Unsupported provider selected.');
        }

        $this->validateProviderEnabled($providerKey);
        $this->validateEggSupport($server, $type);

        $download = $adapter->getDownloadUrl($projectId, $versionId);

        $fileName = $this->normalizeFileName(
            $download['fileName'] ?? null,
            $projectId,
            $versionId,
            $type,
            $download['projectName'] ?? null,
            $download['versionName'] ?? null
        );
        $extension = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
        $this->validateExtension($extension, $type);

        $downloadUrl = $download['url'] ?? null;
        if (empty($downloadUrl)) {
            throw new ModsServiceException('Unable to resolve download URL for the selected file.');
        }

        $maxSize = $this->getMaxSizeForType($type);

        $tempPath = storage_path('app/temp/addon_' . uniqid() . '.' . $extension);
        $tempDir = dirname($tempPath);
        if (!is_dir($tempDir)) {
            mkdir($tempDir, 0755, true);
        }

        $fileHandle = fopen($tempPath, 'w');
        if (!$fileHandle) {
            throw new ModsServiceException('Failed to create temporary file for download.');
        }

        try {
            if (in_array($providerKey, ['spiget', 'spigot'], true)) {
                $preflight = Http::withHeaders([
                    'User-Agent' => config('app.name', 'M12Labs') . ' Marketplace Downloader',
                    'Accept' => '*/*',
                ])
                    ->timeout(60)
                    ->withOptions(['allow_redirects' => ['track_redirects' => true, 'max' => 5]])
                    ->get($downloadUrl);

                $redirects = $this->normalizeRedirectHistory($preflight->header('X-Guzzle-Redirect-History'));
                $finalUrl = $redirects ? end($redirects) : $downloadUrl;
                $finalHost = parse_url($finalUrl, PHP_URL_HOST) ?: '';
                $contentType = strtolower((string) $preflight->header('Content-Type'));

                if (str_contains($finalHost, 'spigotmc.org')) {
                    throw new ModsServiceException('SpigotMC blocks automated downloads for this plugin. Please download manually from the resource page.');
                }

                if (str_contains($contentType, 'text/html')) {
                    throw new ModsServiceException('This plugin requires a manual download from SpigotMC.');
                }
            }

            $response = Http::withHeaders([
                'User-Agent' => config('app.name', 'M12Labs') . ' Marketplace Downloader',
                'Accept' => '*/*',
            ])
                ->timeout(300)
                ->sink($fileHandle)
                ->withOptions(['allow_redirects' => ['track_redirects' => true, 'max' => 5]])
                ->get($downloadUrl);

            if (!$response->successful()) {
                // Header present when Guzzle tracks redirects (see withOptions allow_redirects.track_redirects = true above).
                $redirects = $this->normalizeRedirectHistory($response->header('X-Guzzle-Redirect-History'));
                $redirectsSanitized = array_map(fn ($url) => $this->sanitizeUrlForLogging($url), $redirects);
                $bodyPreview = $this->getResponsePreview($tempPath);
                $sanitizedUrl = $this->sanitizeUrlForLogging($downloadUrl);
                Log::warning('PluginInstallService: provider download failed', [
                    'provider' => $providerKey,
                    'url' => $sanitizedUrl,
                    'status' => $response->status(),
                    'redirects' => $redirectsSanitized,
                    'body_preview' => $bodyPreview,
                ]);
                throw new ModsServiceException('Failed to download file from provider.');
            }

            // If the final host is spigotmc.org or HTML content slipped through, treat as manual download required.
            $redirects = $this->normalizeRedirectHistory($response->header('X-Guzzle-Redirect-History'));
            $finalUrl = $redirects ? end($redirects) : $downloadUrl;
            $finalHost = parse_url($finalUrl, PHP_URL_HOST) ?: '';
            $contentType = strtolower((string) $response->header('Content-Type'));
            if (str_contains($finalHost, 'spigotmc.org') || str_contains($contentType, 'text/html')) {
                throw new ModsServiceException('SpigotMC blocks automated downloads for this plugin. Please download manually from the resource page.');
            }

            $downloadedSize = filesize($tempPath);
            $sizeFromProvider = $download['fileSize'] ?? null;
            $effectiveSize = $sizeFromProvider && $sizeFromProvider > 0 ? $sizeFromProvider : $downloadedSize;

            if ($maxSize && $effectiveSize && $effectiveSize > $maxSize) {
                @unlink($tempPath);
                throw new ModsServiceException('Downloaded file exceeds maximum allowed size.');
            }

            $targetPath = $this->determineInstallPath($type, $fileName);
            $targetPath = $this->ensureUniqueFilePath($server, $targetPath);
            $this->createTargetDirectory($server, $type);

            $this->fileRepository->setServer($server)->putFile($targetPath, $tempPath);

            MarketplaceInstallLog::create([
                'provider'        => $this->normalizeProviderForAnalytics($providerKey),
                'type'            => $type,
                'project_id'      => (string) $projectId,
                'file_size_bytes' => $downloadedSize ?? 0,
                'status'          => MarketplaceInstallLog::STATUS_SUCCESS,
                'server_id'       => $server->id,
                'user_id'         => $userId ?? auth()->id(),
            ]);
        } catch (\Exception $e) {
            Log::error('PluginInstallService download error: ' . $e->getMessage());

            try {
                MarketplaceInstallLog::create([
                    'provider'        => $this->normalizeProviderForAnalytics($providerKey),
                    'type'            => $type,
                    'project_id'      => (string) $projectId,
                    'file_size_bytes' => 0,
                    'status'          => MarketplaceInstallLog::STATUS_FAILED,
                    'server_id'       => $server->id,
                    'user_id'         => $userId ?? auth()->id(),
                ]);
            } catch (\Exception) {
                // never let analytics recording break the user-facing error
            }

            throw $e instanceof ModsServiceException ? $e : new ModsServiceException('An unexpected error occurred while downloading the file.');
        } finally {
            if (is_resource($fileHandle)) {
                fclose($fileHandle);
            }
            @unlink($tempPath);
        }

        return [
            'success' => true,
            'message' => 'File downloaded and uploaded successfully.',
            'file' => [
                'name' => $fileName,
                'path' => $this->determineInstallPath($type, $fileName),
            ],
        ];
    }

    private function normalizeFileName(
        ?string $fileName,
        string|int $projectId,
        string|int $versionId,
        string $type,
        ?string $projectName = null,
        ?string $versionName = null
    ): string {
        $extension = 'jar';
        $base = null;
        $versionSlug = $versionName ? $this->slugify($versionName) : null;
        if ($projectName) {
            $projectSlug = $this->slugify($projectName);
            $base = $versionSlug ? "{$projectSlug}-{$versionSlug}" : $projectSlug;
        }

        if (!$base && !empty($fileName)) {
            $fileParts = pathinfo($fileName);
            $baseFromFile = $this->slugify($fileParts['filename']);
            $fileExt = $fileParts['extension'] ?? null;
            if (!empty($fileExt)) {
                $extension = strtolower($fileExt);
            }
            // Avoid using the filename when it would collapse to the same value as the version slug (bare version name).
            if (!empty($baseFromFile) && $this->shouldUseFilename($baseFromFile, $versionSlug)) {
                $base = $baseFromFile;
            }
        }

        if (!$base) {
            // Problem statement requirement (do not change): fall back to "latest" so the filename follows
            // spigot-{projectId}-{versionName|latest}.jar when the provider omits a version label, avoiding bare version names.
            $versionSlug = $versionSlug ?? 'latest';
            $prefix = $type === 'plugin' ? 'spigot' : $type;
            $base = "{$prefix}-{$projectId}-{$versionSlug}";
        }

        $base = $this->slugify($base);

        if (strlen($base) > 120) {
            $base = substr($base, 0, 120);
        }

        if ($base === '') {
            $base = $type . '_' . $versionId;
        }

        $clean = $base . '.' . $extension;

        return $clean;
    }

    private function slugify(string $value): string
    {
        $value = strtolower($value);
        $value = str_replace(' ', '-', $value);
        $value = preg_replace('/[^a-z0-9._-]/', '', $value) ?? '';
        $value = preg_replace('/-{2,}/', '-', $value);
        return trim($value, '-');
    }

    private function shouldUseFilename(string $baseFromFile, ?string $versionSlug): bool
    {
        return $versionSlug === null || $baseFromFile !== $versionSlug;
    }

    private function validateExtension(string $extension, string $type): void
    {
        $allowed = $this->allowedExtensions[$type] ?? [];
        if (!in_array($extension, $allowed, true)) {
            throw new ModsServiceException('The selected file type is not allowed for this install.');
        }
    }

    private function determineInstallPath(string $type, string $fileName): string
    {
        if ($type === 'plugin') {
            return '/plugins/' . $fileName;
        }

        return '/mods/' . $fileName;
    }

    private function ensureUniqueFilePath(Server $server, string $path): string
    {
        $directory = rtrim(dirname($path), '/');
        $name = basename($path);
        $nameWithoutExt = preg_replace('/\.[^.]+$/', '', $name);
        $ext = pathinfo($name, PATHINFO_EXTENSION);

        $files = [];
        try {
            $files = $this->fileRepository->setServer($server)->getDirectory($directory === '.' ? '/' : $directory);
        } catch (\Exception $e) {
            // ignore listing errors; fall back to original path
            return $path;
        }

        $existing = collect($files)->pluck('name')->filter()->all();
        if (!in_array($name, $existing, true)) {
            return $path;
        }

        $suffix = 1;
        do {
            $candidate = $nameWithoutExt . '-' . $suffix . ($ext ? '.' . $ext : '');
            $suffix++;
        } while (in_array($candidate, $existing, true) && $suffix < 50);

        return ($directory === '.' ? '' : $directory) . '/' . $candidate;
    }

    private function createTargetDirectory(Server $server, string $type): void
    {
        $directory = $type === 'plugin' ? 'plugins' : 'mods';

        try {
            $this->fileRepository->setServer($server)->createDirectory($directory, '/');
        } catch (\Exception $e) {
            // Directory may already exist; ignore.
            Log::info('Install directory creation skipped: ' . $e->getMessage());
        }
    }

    private function validateProviderEnabled(string $provider): void
    {
        $modsEnabled = (bool) Setting::get('settings::modules:mods:enabled', config('modules.mods.enabled', false));

        if (!$modsEnabled) {
            throw new ModsServiceException('Mods module is not enabled.');
        }
    }

    private function validateEggSupport(Server $server, string $type): void
    {
        if ($type !== 'plugin') {
            return;
        }

        $egg = $server->egg;
        if (!$egg) {
            throw new ModsServiceException('Unable to determine server egg for plugin installs.');
        }

        /** @var Product|null $product */
        $product = $server->product()->with('category')->first();
        $category = $product?->category;
        $allowedEggs = $category ? $category->getAllowedEggs() : [];

        if (!empty($allowedEggs) && !in_array($egg->id, $allowedEggs)) {
            throw new ModsServiceException('Plugins can only be installed on permitted eggs for this server.');
        }
    }

    /**
     * Determine the maximum allowed download size (in bytes) for the provided install type.
     */
    private function getMaxSizeForType(string $type): int
    {
        return match ($type) {
            'plugin' => (int) Setting::get('settings::modules:mods:max_plugin_size', config('modules.mods.max_plugin_size', self::DEFAULT_MAX_PLUGIN_SIZE)),
            default  => (int) Setting::get('settings::modules:mods:max_mod_size', config('modules.mods.max_mod_size', self::DEFAULT_MAX_MOD_SIZE)),
        };
    }

    private function getResponsePreview(string $path): ?string
    {
        if (!is_file($path) || !is_readable($path)) {
            return null;
        }

        $fileSize = filesize($path);
        if ($fileSize === false) {
            return null;
        }

        if ($fileSize > self::BODY_PREVIEW_MAX_BYTES) {
            Log::info('PluginInstallService: skipping response preview due to size', ['path' => $path, 'bytes' => $fileSize]);

            return null;
        }

        $content = @file_get_contents($path, false, null, 0, self::BODY_PREVIEW_READ_BYTES);

        if ($content === false) {
            Log::warning('PluginInstallService: unable to read response preview', ['path' => $path]);

            return null;
        }

        // Treat responses containing control characters (excluding TAB \x09, LF \x0A, CR \x0D which are common in text) as non-text and skip logging content.
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', $content)) {
            return '[non-text response omitted]';
        }

        return $content;
    }

    private function sanitizeUrlForLogging(string $url): string
    {
        $parsed = parse_url($url);

        if ($parsed !== false && !empty($parsed['host'])) {
            $scheme = $parsed['scheme'] ?? '[unknown-scheme]';

            return $scheme . '://' . $parsed['host'] . ($parsed['path'] ?? '');
        }

        $parts = preg_split('/[?#]/', $url, 2);
        $withoutQuery = is_array($parts) ? $parts[0] : '';

        return $withoutQuery !== '' ? $withoutQuery : '[invalid-url]';
    }

    private function normalizeRedirectHistory(string|array|null $header): array
    {
        if (!$header) {
            return [];
        }

        return is_array($header) ? $header : [$header];
    }

    private function normalizeProviderForAnalytics(string $providerKey): string
    {
        return match ($providerKey) {
            'spiget', 'spigot' => 'spigot',
            default => $providerKey,
        };
    }
}
