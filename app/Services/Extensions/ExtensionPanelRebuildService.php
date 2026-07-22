<?php

namespace Everest\Services\Extensions;

use Illuminate\Support\Facades\File;
use Symfony\Component\Process\Process;
use Everest\Exceptions\DisplayException;
use Symfony\Component\Process\ExecutableFinder;

class ExtensionPanelRebuildService
{
    public function __construct(
        private ExtensionFilesystemOwnershipService $ownershipService,
    ) {
    }

    /**
     * Run the fixed rebuild hooks required after filesystem changes.
     *
     * An optional callback receives the zero-based command index just before
     * each command runs, allowing callers to report progress stages at the
     * correct moment (e.g. 'optimizing' before optimize:clear, 'building'
     * before the frontend build).
     *
     * @return array<int, array{command: string, output: string}>
     */
    public function rebuild(string $reason, ?callable $onCommandStart = null): array
    {
        $commands = [
            ['php', 'artisan', 'optimize:clear'],
            $this->getFrontendBuildCommand(),
        ];

        $output = [];
        $environment = $this->getProcessEnvironment($reason);

        foreach ($commands as $index => $command) {
            if ($onCommandStart !== null) {
                $onCommandStart($index);
            }

            // Before the frontend build, validate (and auto-repair when root)
            // filesystem ownership so permission problems produce a clear error
            // instead of a cryptic mid-build failure.
            if ($index === 1) {
                $this->ownershipService->validateBuildWorkspaceOwnership();
            }

            $process = new Process($command, base_path(), $environment);
            $process->setTimeout(1800);
            $process->run();

            $combinedOutput = trim($process->getOutput() . "\n" . $process->getErrorOutput());
            $output[] = [
                'command' => implode(' ', $command),
                'output' => $combinedOutput,
            ];

            if (!$process->isSuccessful()) {
                throw new DisplayException(sprintf('M12Labs rebuild failed while running "%s".', implode(' ', $command)), new \RuntimeException($combinedOutput));
            }
        }

        return $output;
    }

    /**
     * @return array<int, string>
     */
    private function getFrontendBuildCommand(): array
    {
        $finder = new ExecutableFinder();

        $pnpm = $finder->find('pnpm');
        if (File::exists(base_path('pnpm-lock.yaml')) && $pnpm) {
            return [$pnpm, 'build'];
        }

        $npm = $finder->find('npm');
        if ($npm) {
            return [$npm, 'run', 'build'];
        }

        throw new DisplayException('Unable to rebuild M12Labs because neither pnpm nor npm is available on this host.');
    }

    /**
     * @return array<string, string>
     */
    private function getProcessEnvironment(string $reason): array
    {
        $home = storage_path('app/extensions/runtime-home');
        $cache = $home . '/.cache';
        $corepack = $cache . '/corepack';
        $npmCache = $cache . '/npm';
        $pnpmStore = $home . '/.local/share/pnpm/store';
        $pnpmHome = $home . '/.local/share/pnpm';
        $xdgData = $home . '/.local/share';
        $xdgState = $home . '/.local/state';

        File::ensureDirectoryExists($corepack);
        File::ensureDirectoryExists($npmCache);
        File::ensureDirectoryExists($pnpmHome);
        File::ensureDirectoryExists($pnpmStore);
        File::ensureDirectoryExists($xdgState);

        return [
            'M12LABS_EXTENSION_REBUILD_REASON' => $reason,
            // The rebuild runs head-less from PHP with no TTY. When pnpm needs to
            // purge and re-create node_modules (e.g. the store dir differs from
            // the one node_modules was built against, which happens the first
            // time an install runs under the www-data-owned runtime store), it
            // refuses to remove the directory without a TTY unless CI is set.
            'CI' => 'true',
            'PNPM_CONFIG_CONFIRM_MODULES_PURGE' => 'false',
            'npm_config_confirm_modules_purge' => 'false',
            'HOME' => $home,
            'PATH' => (string) (getenv('PATH') ?: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'),
            'XDG_CACHE_HOME' => $cache,
            'XDG_DATA_HOME' => $xdgData,
            'XDG_STATE_HOME' => $xdgState,
            'COREPACK_HOME' => $corepack,
            'COREPACK_ENABLE_DOWNLOAD_PROMPT' => '0',
            'npm_config_cache' => $npmCache,
            'NPM_CONFIG_CACHE' => $npmCache,
            'PNPM_HOME' => $pnpmHome,
            'PNPM_STORE_DIR' => $pnpmStore,
            'pnpm_config_store_dir' => $pnpmStore,
            // Keep using the host pnpm binary instead of switching into
            // a runtime-managed CLI under storage (can fail with EACCES on
            // hardened/noexec mounts during extension install rebuilds).
            'NPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS' => 'false',
            'npm_config_manage_package_manager_versions' => 'false',
            'PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS' => 'false',
            'pnpm_config_manage_package_manager_versions' => 'false',
        ];
    }
}
