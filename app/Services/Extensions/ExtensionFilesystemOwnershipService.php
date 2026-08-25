<?php

namespace Everest\Services\Extensions;

use Everest\Exceptions\DisplayException;

class ExtensionFilesystemOwnershipService
{
    /**
     * @return array<string, mixed>
     */
    public function repairStandardPaths(?string $extensionId = null): array
    {
        if (!$this->isRunningAsRoot()) {
            return [];
        }

        $ownership = $this->resolveOwnershipTarget();
        if ($ownership === null) {
            return [];
        }

        $paths = array_merge([
            storage_path('app/extensions'),
        ], $this->buildOutputPaths());

        if ($extensionId !== null && $extensionId !== '') {
            $paths[] = base_path(sprintf('app/Extensions/Packages/%s', $extensionId));
            $paths[] = base_path(sprintf('frontend/src/extensions/packages/%s', $extensionId));
        } else {
            $paths[] = base_path('app/Extensions/Packages');
            $paths[] = base_path('frontend/src/extensions');
        }

        $repaired = [];
        foreach (array_unique($paths) as $path) {
            if (!file_exists($path)) {
                continue;
            }

            $this->applyOwnership($path, $ownership['uid'], $ownership['gid']);
            $repaired[] = $path;
        }

        return [
            'user' => $ownership['user'],
            'group' => $ownership['group'],
            'sourcePath' => $ownership['sourcePath'],
            'paths' => $repaired,
        ];
    }

    public function ensureWritablePath(string $path, string $label): void
    {
        $probe = file_exists($path) ? $path : $this->findClosestExistingPath(dirname($path));
        if ($probe !== null && is_writable($probe)) {
            return;
        }

        throw new DisplayException(sprintf('M12Labs cannot write to "%s". Repair the panel file ownership and permissions, then try again. Files created by a root-run extension install or uninstall should belong to the panel user (for example www-data).', $label));
    }

    public function ensureRemovablePath(string $path, string $label): void
    {
        $probe = $this->findClosestExistingPath(dirname($path));
        if ($probe !== null && is_writable($probe)) {
            return;
        }

        throw new DisplayException(sprintf('M12Labs cannot remove "%s". Repair the panel file ownership and permissions, then try again. Files created by a root-run extension install or uninstall should belong to the panel user (for example www-data).', $label));
    }

    public function isRunningAsRoot(): bool
    {
        return function_exists('posix_geteuid') && posix_geteuid() === 0;
    }

    /**
     * Validate that the build workspace paths are writable before the frontend build runs.
     *
     * When running as root, any path whose owner doesn't match the panel user
     * (including root-owned paths in application directories) is repaired
     * automatically. When not running as root, writability is checked directly
     * so that bad permissions — including root-owned files left by a previous
     * root-run build — are caught before pnpm/npm starts.
     *
     * @throws DisplayException if any path is not writable and cannot be repaired automatically
     */
    public function validateBuildWorkspaceOwnership(): void
    {
        $ownership = $this->resolveOwnershipTarget();

        $candidates = array_merge([
            base_path(),
            base_path('vendor'),
            storage_path('app/extensions/runtime-home'),
        ], $this->buildOutputPaths());

        $mismatched = [];

        foreach ($candidates as $path) {
            if (!file_exists($path)) {
                continue;
            }

            if ($this->isRunningAsRoot()) {
                // When running as root, repair any path whose owner doesn't match
                // the panel user — including root-owned application paths.
                if ($ownership === null) {
                    continue;
                }

                $actualUid = @fileowner($path);
                if ($actualUid === false || $actualUid === $ownership['uid']) {
                    continue;
                }

                $this->applyOwnership($path, $ownership['uid'], $ownership['gid']);
            } else {
                // When not running as root, check real writability. This catches
                // root-owned directories and files left by a previous root-run build
                // that would cause pnpm/npm to fail with EACCES.
                if (is_writable($path)) {
                    continue;
                }

                $mismatched[] = $path;
            }
        }

        if ($mismatched === []) {
            return;
        }

        $user  = $ownership['user'] ?? 'the panel user';
        $group = $ownership['group'] ?? 'the panel group';

        throw new DisplayException(sprintf('M12Labs cannot start the build because %d path(s) are not writable: %s. Run "sudo chown -R %s:%s <path>" for each path listed to repair ownership, then try again.', count($mismatched), implode(', ', $mismatched), $user, $group));
    }

    /**
     * Directories the frontend rebuild writes to and can leave root-owned when
     * an install/update is run as root (the pnpm/paraglide/vite processes
     * inherit the invoking user). These must be handed back to the panel user
     * so a later www-data-run rebuild does not fail with EACCES while TypeScript,
     * Paraglide, or Vite regenerates its output.
     *
     * @return array<int, string>
     */
    private function buildOutputPaths(): array
    {
        return [
            base_path('node_modules'),
            base_path('frontend/node_modules'),
            base_path('frontend/src/i18n/generated'),
            base_path('frontend/src/paraglide'),
            base_path('public/build'),
        ];
    }

    /**
     * @return array{uid: int, gid: int, user: string, group: string, sourcePath: string}|null
     */
    private function resolveOwnershipTarget(): ?array
    {
        $envUser = config('modules.extensions.panel_owner');
        $envGroup = config('modules.extensions.panel_group');
        if (is_string($envUser) && is_string($envGroup) && function_exists('posix_getpwnam') && function_exists('posix_getgrnam')) {
            $userInfo = posix_getpwnam($envUser);
            $groupInfo = posix_getgrnam($envGroup);

            if (is_array($userInfo) && is_array($groupInfo)) {
                return [
                    'uid' => (int) $userInfo['uid'],
                    'gid' => (int) $groupInfo['gid'],
                    'user' => $envUser,
                    'group' => $envGroup,
                    'sourcePath' => 'environment',
                ];
            }
        }

        foreach ([
            storage_path(),
            storage_path('logs'),
            base_path('frontend'),
            base_path('bootstrap/cache'),
            base_path('public'),
        ] as $candidate) {
            if (!file_exists($candidate)) {
                continue;
            }

            $uid = @fileowner($candidate);
            $gid = @filegroup($candidate);
            if ($uid === false || $gid === false) {
                continue;
            }

            if ($uid === 0 && $gid === 0) {
                continue;
            }

            return [
                'uid' => (int) $uid,
                'gid' => (int) $gid,
                'user' => $this->resolveUserName((int) $uid),
                'group' => $this->resolveGroupName((int) $gid),
                'sourcePath' => $candidate,
            ];
        }

        foreach ([['www-data', 'www-data'], ['nginx', 'nginx'], ['apache', 'apache']] as [$user, $group]) {
            if (!function_exists('posix_getpwnam') || !function_exists('posix_getgrnam')) {
                continue;
            }

            $userInfo = posix_getpwnam($user);
            $groupInfo = posix_getgrnam($group);
            if (!is_array($userInfo) || !is_array($groupInfo)) {
                continue;
            }

            return [
                'uid' => (int) $userInfo['uid'],
                'gid' => (int) $groupInfo['gid'],
                'user' => $user,
                'group' => $group,
                'sourcePath' => 'fallback:' . $user,
            ];
        }

        return null;
    }

    private function applyOwnership(string $path, int $uid, int $gid): void
    {
        $this->chownPath($path, $uid, $gid);

        if (!is_dir($path)) {
            return;
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \RecursiveDirectoryIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        /** @var \SplFileInfo $item */
        foreach ($iterator as $item) {
            $this->chownPath($item->getPathname(), $uid, $gid);
        }
    }

    private function chownPath(string $path, int $uid, int $gid): void
    {
        if (!file_exists($path)) {
            return;
        }

        @chown($path, $uid);
        @chgrp($path, $gid);

        if (is_dir($path)) {
            @chmod($path, 0755);

            return;
        }

        if (is_file($path)) {
            @chmod($path, 0644);
        }
    }

    private function findClosestExistingPath(string $path): ?string
    {
        $candidate = $path;

        while ($candidate !== '' && $candidate !== DIRECTORY_SEPARATOR && !file_exists($candidate)) {
            $parent = dirname($candidate);
            if ($parent === $candidate) {
                return null;
            }

            $candidate = $parent;
        }

        return file_exists($candidate) ? $candidate : null;
    }

    private function resolveUserName(int $uid): string
    {
        if (function_exists('posix_getpwuid')) {
            $info = posix_getpwuid($uid);
            if (is_array($info) && !empty($info['name'])) {
                return (string) $info['name'];
            }
        }

        return (string) $uid;
    }

    private function resolveGroupName(int $gid): string
    {
        if (function_exists('posix_getgrgid')) {
            $info = posix_getgrgid($gid);
            if (is_array($info) && !empty($info['name'])) {
                return (string) $info['name'];
            }
        }

        return (string) $gid;
    }
}
