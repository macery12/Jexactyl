<?php

namespace Everest\Services\Extensions;

use Everest\Exceptions\DisplayException;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use ZipArchive;

class ExtensionPackageArtifactService
{
    public const MANIFEST_FILENAME = 'm12labs-extension.json';
    public const PACKAGE_ARTIFACT_FILENAME = 'package.M12LabsExtension';

    /**
     * @return array<string, mixed>
     */
    public function inspectArchive(string $archivePath, ?string $workingDirectory = null): array
    {
        $resolvedPath = $this->resolveArchivePath($archivePath, $workingDirectory);

        $zip = new ZipArchive();
        if ($zip->open($resolvedPath) !== true) {
            throw new DisplayException(sprintf('The extension package file "%s" could not be opened.', $resolvedPath));
        }

        try {
            $rawManifest = $zip->getFromName(self::MANIFEST_FILENAME);
            if (!is_string($rawManifest)) {
                throw new DisplayException(sprintf('The extension package "%s" does not contain %s.', basename($resolvedPath), self::MANIFEST_FILENAME));
            }

            $manifest = json_decode($rawManifest, true, 512, JSON_THROW_ON_ERROR);
            if (!is_array($manifest)) {
                throw new DisplayException(sprintf('The extension package "%s" contains an invalid manifest.', basename($resolvedPath)));
            }
        } catch (\JsonException $exception) {
            throw new DisplayException(sprintf('The extension package "%s" contains malformed manifest JSON.', basename($resolvedPath)), $exception);
        } finally {
            $zip->close();
        }

        $extensionId = trim((string) Arr::get($manifest, 'extension.id', ''));
        $version = trim((string) Arr::get($manifest, 'package.version', ''));

        if ($extensionId === '' || $version === '') {
            throw new DisplayException(sprintf('The extension package "%s" is missing extension.id or package.version.', basename($resolvedPath)));
        }

        return [
            'archivePath' => $resolvedPath,
            'archiveName' => basename($resolvedPath),
            'extensionId' => $extensionId,
            'packageId' => trim((string) Arr::get($manifest, 'package.id', $extensionId)),
            'version' => $version,
            'name' => trim((string) Arr::get($manifest, 'extension.name', $extensionId)),
            'description' => trim((string) Arr::get($manifest, 'extension.description', '')),
            'route' => trim((string) Arr::get($manifest, 'extension.route', $extensionId)),
            'fileCount' => count((array) Arr::get($manifest, 'files', [])),
            'compatiblePanelVersions' => array_values(array_filter((array) Arr::get($manifest, 'compatiblePanelVersions', []), 'is_string')),
            'manifest' => $manifest,
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function discoverArchives(string $directory): array
    {
        if (!is_dir($directory)) {
            return [];
        }

        $archives = [];
        $entries = scandir($directory) ?: [];
        sort($entries);

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = rtrim($directory, '/') . '/' . $entry;
            if (!is_file($path) || !$this->isSupportedArchiveName($path)) {
                continue;
            }

            try {
                $archives[] = $this->inspectArchive($path, $directory);
            } catch (\Throwable $exception) {
                $archives[] = [
                    'archivePath' => realpath($path) ?: $path,
                    'archiveName' => basename($path),
                    'error' => $exception->getMessage(),
                ];
            }
        }

        return $archives;
    }

    public function looksLikeArchiveReference(string $value, ?string $workingDirectory = null): bool
    {
        $value = trim($value);
        if ($value === '') {
            return false;
        }

        if ($this->isSupportedArchiveName($value)) {
            return true;
        }

        if (Str::startsWith($value, 'file://')) {
            return true;
        }

        if (Str::contains($value, ['/','\\'])) {
            return true;
        }

        if ($workingDirectory) {
            $candidate = rtrim($workingDirectory, '/') . '/' . $value;

            return is_file($candidate) && $this->isSupportedArchiveName($candidate);
        }

        return false;
    }

    public function resolveArchivePath(string $archivePath, ?string $workingDirectory = null): string
    {
        $archivePath = trim($archivePath);
        if ($archivePath === '') {
            throw new DisplayException('Provide a path to a local .M12LabsExtension package file.');
        }

        if (Str::startsWith($archivePath, 'file://')) {
            $archivePath = rawurldecode(substr($archivePath, 7));
        }

        $candidates = [$archivePath];

        if (!Str::startsWith($archivePath, '/')) {
            if ($workingDirectory) {
                $candidates[] = rtrim($workingDirectory, '/') . '/' . $archivePath;
            }

            $candidates[] = base_path($archivePath);
        }

        foreach ($candidates as $candidate) {
            $resolved = realpath($candidate);
            if ($resolved && is_file($resolved) && $this->isSupportedArchiveName($resolved)) {
                return $resolved;
            }
        }

        throw new DisplayException(sprintf('The extension package file "%s" was not found.', $archivePath));
    }

    // ---------------------------------------------------------------------------
    // Shared archive helpers — used by install and update services
    // ---------------------------------------------------------------------------

    public function downloadArchive(string $location, string $destination): void
    {
        if (Str::startsWith($location, ['http://', 'https://'])) {
            $response = Http::timeout(120)->withOptions(['sink' => $destination])->get($location);
            if (!$response->successful()) {
                throw new DisplayException(sprintf('Unable to download extension archive from "%s".', $location));
            }

            return;
        }

        $sourcePath = Str::startsWith($location, 'file://') ? rawurldecode(substr($location, 7)) : $location;
        if (!is_file($sourcePath)) {
            throw new DisplayException(sprintf('Extension archive "%s" was not found.', $sourcePath));
        }

        File::copy($sourcePath, $destination);
    }

    public function verifyChecksum(string $path, string $expectedChecksum, string $label): void
    {
        if (hash_file('sha256', $path) !== $expectedChecksum) {
            throw new DisplayException(sprintf('The %s checksum did not match the manifest.', $label));
        }
    }

    public function extractArchive(string $archivePath, string $extractPath): void
    {
        $zip = new ZipArchive();
        if ($zip->open($archivePath) !== true) {
            throw new DisplayException('The downloaded extension archive could not be opened.');
        }

        if (!$zip->extractTo($extractPath)) {
            $zip->close();

            throw new DisplayException('The downloaded extension archive could not be extracted.');
        }

        $zip->close();
    }

    /**
     * @return array<string, mixed>
     */
    public function readPackageManifest(string $extractPath): array
    {
        $manifestPath = $extractPath . '/' . self::MANIFEST_FILENAME;
        if (!is_file($manifestPath)) {
            throw new DisplayException('The extension archive did not include an m12labs-extension.json manifest.');
        }

        $manifest = json_decode(File::get($manifestPath), true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($manifest)) {
            throw new DisplayException('The extension package manifest is invalid.');
        }

        return $manifest;
    }

    /**
     * Validate the manifest's extension id / version against expected values and return it unchanged.
     *
     * @param array<string, mixed> $manifest
     * @return array<string, mixed>
     */
    public function normalizeManifest(array $manifest, ?string $expectedExtensionId = null, ?string $expectedVersion = null): array
    {
        $extensionId = trim((string) Arr::get($manifest, 'extension.id', ''));
        $version = trim((string) Arr::get($manifest, 'package.version', ''));

        if ($extensionId === '' || $version === '') {
            throw new DisplayException('The extension package manifest is missing required metadata.');
        }

        if ($expectedExtensionId !== null && $extensionId !== $expectedExtensionId) {
            throw new DisplayException('The downloaded package does not match the requested extension id.');
        }

        if ($expectedVersion !== null && $version !== $expectedVersion) {
            throw new DisplayException('The downloaded package version does not match the repository manifest.');
        }

        return $manifest;
    }

    /**
     * @param array<int, string> $versions
     */
    public function assertCompatiblePanelVersions(array $versions): void
    {
        $versions = array_values(array_filter($versions, 'is_string'));
        if ($versions === []) {
            return;
        }

        $currentVersion = (string) config('app.version');
        if (!in_array($currentVersion, $versions, true)) {
            throw new DisplayException(sprintf(
                'This extension package supports M12Labs panel versions %s. The current panel version is %s.',
                implode(', ', $versions),
                $currentVersion
            ));
        }
    }

    public function normalizeTargetPath(string $path, string $extensionId): string
    {
        $normalized = str_replace('\\', '/', trim($path));
        $normalized = trim($normalized, '/');

        if ($normalized === '' || Str::contains($normalized, ['../', '..\\']) || Str::startsWith($normalized, '/')) {
            throw new DisplayException('The extension package includes an unsafe target path.');
        }

        $allowedPrefixes = [
            sprintf('app/Extensions/Packages/%s/', $extensionId),
            sprintf('frontend/src/extensions/packages/%s/', $extensionId),
        ];

        foreach ($allowedPrefixes as $prefix) {
            if (Str::startsWith($normalized, $prefix)) {
                return $normalized;
            }
        }

        throw new DisplayException(sprintf('The package target path "%s" is not allowed by M12Labs.', $normalized));
    }

    private function isSupportedArchiveName(string $path): bool
    {
        return Str::endsWith(Str::lower($path), ['.m12labsextension', '.zip']);
    }
}