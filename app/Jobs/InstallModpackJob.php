<?php

namespace Everest\Jobs;

use Everest\Models\DownloadQueue;
use Everest\Models\MarketplaceInstallLog;
use Everest\Services\Mods\CurseForgeService;
use Everest\Repositories\Wings\DaemonScriptRepository;
use Everest\Repositories\Wings\DaemonServerRepository;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Installs a CurseForge modpack with a "resolve on panel, download on node" model,
 * split into many short Wings /script calls so each panel->Wings request returns
 * well under any proxy timeout (notably Cloudflare's ~100s cap, which otherwise
 * 524s a single long-running install).
 *
 * Phases (each persisted to the download_queue row for live UI display):
 *   wiping     – optional full-server wipe (rm everything) for a clean install
 *   loader     – optional: set the server's startup + Java image and install the
 *                exact Forge/NeoForge/Fabric/Quilt version the pack needs via /script
 *   overrides  – download the pack zip on the node and extract its overrides
 *   mods       – download every mod in batches (resumable, idempotent)
 *   verifying  – re-sweep to self-heal transient gaps
 *
 * The panel resolves all URLs; the scripts need only curl/unzip/java (no jq, no
 * CurseForge key on the node).
 */
class InstallModpackJob extends Job implements ShouldQueue
{
    use InteractsWithQueue;
    use SerializesModels;

    public int $timeout = 3600;
    public int $tries   = 3;

    private const BATCH_SENTINEL        = 'M12_BATCH_DONE';
    private const OVERRIDES_SENTINEL    = 'OVERRIDES_DONE';
    private const LOADER_SENTINEL       = 'M12_LOADER_DONE';
    private const WIPE_SENTINEL         = 'M12_WIPE_DONE';
    private const SERVER_SIDE_UNSUPPORTED = 3;

    public function __construct(
        public DownloadQueue $parent,
        public bool $wipeServer,
        public bool $installLoader,
    ) {
        $this->queue   = 'standard';
        $this->timeout = (int) config('modules.mods.installer.install_timeout', 3600);
        $this->tries   = (int) config('modules.mods.installer.tries', 3);
    }

    public function handle(
        CurseForgeService $curseForge,
        DaemonScriptRepository $scriptRepo,
        DaemonServerRepository $serverRepo,
    ): void {
        $parent = $this->parent;
        $server = $parent->server;

        // A resumed attempt (job retry) that already reached the mods stage must not
        // re-wipe / re-install the loader / re-extract overrides.
        $resumePhase = $parent->phase;
        $preModsDone = $resumePhase !== null
            && (str_starts_with($resumePhase, 'mods') || $resumePhase === 'verifying');

        if (!$parent->started_at) {
            $parent->update(['started_at' => now()]);
        }
        $parent->update(['status' => DownloadQueue::STATUS_DOWNLOADING]);
        if (!$preModsDone) {
            $parent->update(['phase' => 'preparing']);
        }

        $scriptRepo->setServer($server);
        $callTimeout   = (int) config('modules.mods.installer.call_timeout', 90);
        $loaderTimeout = (int) config('modules.mods.installer.loader_timeout', 90);
        $batch         = max(1, (int) config('modules.mods.installer.mods_per_batch', 100));

        $tempPath = null;
        $notes    = [];

        try {
            $projectId = (int) $parent->project_id;
            $fileId    = (int) $parent->file_id;

            // Resolve the pack zip URL (API url preferred, CDN fallback if enabled).
            $zipMeta = $curseForge->resolveFiles([$fileId])[$fileId] ?? null;
            $zipUrl  = $zipMeta['download_url'] ?? null;
            if (empty($zipUrl)) {
                throw new \RuntimeException('This modpack file cannot be downloaded (distribution disabled by the author).');
            }

            // Download the zip to temp — only to read manifest.json on the panel.
            $tempPath = storage_path('app/temp/modpack_manifest_' . uniqid() . '.zip');
            $tempDir  = dirname($tempPath);
            if (!is_dir($tempDir)) {
                mkdir($tempDir, 0755, true);
            }
            $this->downloadFile($zipUrl, $tempPath);

            [$overridesRoot, $fileIds, $projectIdByFileId, $loaderName, $loaderVersion, $mcVersion] = $this->parseManifest($tempPath);
            @unlink($tempPath);
            $tempPath = null;

            // Resolve every mod file to a download URL.
            $resolved = $curseForge->resolveFiles($fileIds);

            // Fetch serverSide compatibility for each project in the manifest.
            $projectIds    = array_values(array_unique(array_filter(array_values($projectIdByFileId))));
            $serverSideMap = $curseForge->getModsServerSide($projectIds);

            // Split into installable, blocked (no download URL), and client-side-only.
            $installable    = [];
            $blocked        = [];
            $clientSideOnly = [];
            foreach ($fileIds as $fid) {
                $meta      = $resolved[$fid] ?? null;
                $name      = $meta['file_name'] ?? ('file-' . $fid . '.jar');
                $projectId = $projectIdByFileId[$fid] ?? 0;
                $side      = $serverSideMap[$projectId] ?? 0;

                if ($side === self::SERVER_SIDE_UNSUPPORTED) {
                    $clientSideOnly[] = $name;
                    continue;
                }

                if ($meta && !empty($meta['download_url'])) {
                    $installable[] = [
                        'url'  => $meta['download_url'],
                        'name' => $name,
                        'sha1' => $meta['sha1'] ?? '',
                    ];
                } else {
                    $blocked[] = $name;
                }
            }

            $total = count($installable);

            // ── Pre-mods: wipe → loader → overrides. Skipped wholesale on a mods resume. ──
            if (!$preModsDone) {
                // Step: full-server wipe.
                if ($this->wipeServer) {
                    $parent->update(['phase' => 'wiping', 'total_children' => $total]);
                    $res = $scriptRepo->run($this->buildWipeScript(), [], $callTimeout);
                    if (!str_contains($res['stdout'] ?? '', self::WIPE_SENTINEL)) {
                        $parent->update(['install_log' => $this->buildFailLog('Server wipe', $res)]);
                        throw new \RuntimeException($this->firstError($res['stderr'] ?? '') ?: 'Server wipe did not complete.');
                    }
                }

                // Step: loader install (set startup + Java image, run installer in a Java image).
                if ($this->installLoader) {
                    if (!$loaderName || !$loaderVersion || !$mcVersion) {
                        throw new \RuntimeException('Could not determine the modpack loader from its manifest.');
                    }

                    $parent->update(['phase' => 'loader', 'total_children' => $total]);

                    $installerUrl = $this->resolveInstallerUrl($loaderName);

                    // The server RUNS on a yolks image; the loader installer must RUN on a
                    // root image so it can write /mnt/server (yolks drops to a non-root user).
                    $server->update([
                        'startup' => (string) config('modules.mods.installer.universal_startup'),
                        'image'   => $this->resolveJavaImage($mcVersion),
                    ]);
                    $serverRepo->setServer($server)->sync();

                    $res = $scriptRepo->run(
                        $this->buildLoaderScript($loaderName, $loaderVersion, $mcVersion, $installerUrl),
                        [],
                        $loaderTimeout,
                        $this->resolveLoaderImage($mcVersion),
                    );
                    if (!str_contains($res['stdout'] ?? '', self::LOADER_SENTINEL)) {
                        $parent->update(['install_log' => $this->buildFailLog('Loader install', $res)]);
                        throw new \RuntimeException($this->firstError($res['stderr'] ?? '') ?: 'Loader install did not complete.');
                    }
                    $notes[] = ucfirst($loaderName) . " {$loaderVersion} installed for Minecraft {$mcVersion}.";
                }

                // Step: overrides.
                $parent->update(['phase' => 'overrides', 'total_children' => $total]);
                $res = $scriptRepo->run($this->buildOverridesScript($zipUrl, $overridesRoot), [], $callTimeout);
                if (!str_contains($res['stdout'] ?? '', self::OVERRIDES_SENTINEL)) {
                    $parent->update(['install_log' => $this->buildFailLog('Overrides', $res)]);
                    throw new \RuntimeException($this->firstError($res['stderr'] ?? '') ?: 'Overrides step did not complete.');
                }

                $parent->update(['phase' => 'mods', 'completed_children' => 0, 'failed_children' => 0]);
            }

            // ── Mods, in batches. Resume from the persisted offset. ──
            $offset = (int) ($parent->completed_children ?? 0);
            $failed = (int) ($parent->failed_children ?? 0);

            $this->runModBatches($scriptRepo, $parent, $installable, $offset, $failed, $batch, $callTimeout);

            // ── Verification sweep: self-heal transient gaps without user action. ──
            if ((int) $parent->failed_children > 0) {
                $parent->update(['phase' => 'verifying', 'completed_children' => 0, 'failed_children' => 0]);
                $this->runModBatches($scriptRepo, $parent, $installable, 0, 0, $batch, $callTimeout);
            }

            $stillFailed = (int) $parent->failed_children;
            $skipped     = $stillFailed + count($blocked) + count($clientSideOnly);

            $parent->update([
                'status'             => DownloadQueue::STATUS_COMPLETED,
                'phase'              => null,
                'completed_children' => $total,
                'error_message'      => $skipped > 0 ? "{$skipped} mod(s) could not be installed." : null,
                'install_log'        => $this->buildLog($total, $stillFailed, $blocked, $clientSideOnly, $notes),
                'completed_at'       => now(),
            ]);

            $this->recordAudit($server, MarketplaceInstallLog::STATUS_SUCCESS);
        } catch (\Exception $e) {
            Log::error('InstallModpackJob failed', [
                'parent_id' => $parent->id,
                'error'     => $e->getMessage(),
            ]);

            $parent->update([
                'status'        => DownloadQueue::STATUS_FAILED,
                'error_message' => $e->getMessage(),
                'completed_at'  => now(),
            ]);

            $this->recordAudit($server, MarketplaceInstallLog::STATUS_FAILED);
        } finally {
            if ($tempPath) {
                @unlink($tempPath);
            }
        }
    }

    /**
     * Download every mod in $installable from $offset onward, one short script call
     * per batch. Persists progress to the row after each call.
     *
     * @param array<int, array{url: string, name: string, sha1: string}> $installable
     */
    private function runModBatches(
        DaemonScriptRepository $scriptRepo,
        DownloadQueue $parent,
        array $installable,
        int $offset,
        int $failed,
        int $batch,
        int $callTimeout,
    ): void {
        $total   = count($installable);
        $batches = (int) ceil($total / $batch);

        while ($offset < $total) {
            $slice   = array_slice($installable, $offset, $batch);
            $batchNo = intdiv($offset, $batch) + 1;

            $parent->update([
                'total_children'     => $total,
                'completed_children' => $offset,
                'failed_children'    => $failed,
                'phase'              => 'mods:' . $batchNo . '/' . $batches,
            ]);

            $res    = $scriptRepo->run($this->buildModsBatchScript($slice), [], $callTimeout);
            $stdout = $res['stdout'] ?? '';

            if (!str_contains($stdout, self::BATCH_SENTINEL)) {
                throw new \RuntimeException($this->firstError($res['stderr'] ?? '') ?: 'A mod batch did not complete.');
            }

            [$processed, , $batchFailed] = $this->parseBatch($stdout);
            $offset += max($processed, 1);
            $failed += $batchFailed;

            $parent->update([
                'completed_children' => min($offset, $total),
                'failed_children'    => $failed,
            ]);
        }
    }

    /**
     * Open the pack zip and read manifest.json. Returns the overrides root folder,
     * the list of CurseForge file ids (whole pack), a fileId→projectId map, and
     * the primary loader name + version + Minecraft version from manifest.minecraft.
     *
     * @return array{0: string, 1: int[], 2: array<int,int>, 3: ?string, 4: ?string, 5: ?string}
     */
    private function parseManifest(string $zipPath): array
    {
        $zip = new \ZipArchive();
        if ($zip->open($zipPath) !== true) {
            throw new \RuntimeException('Failed to open modpack archive.');
        }

        try {
            $manifestJson = $zip->getFromName('manifest.json');
            if ($manifestJson === false) {
                throw new \RuntimeException('manifest.json not found in modpack archive.');
            }

            $manifest = json_decode($manifestJson, true);
            if (!is_array($manifest)) {
                throw new \RuntimeException('Failed to parse manifest.json.');
            }

            $overridesRoot = rtrim($manifest['overrides'] ?? 'overrides', '/');

            $fileIds           = [];
            $projectIdByFileId = [];
            foreach ($manifest['files'] ?? [] as $ref) {
                $fid = (int) ($ref['fileID'] ?? 0);
                $pid = (int) ($ref['projectID'] ?? 0);
                if ($fid !== 0) {
                    $fileIds[] = $fid;
                    if ($pid !== 0) {
                        $projectIdByFileId[$fid] = $pid;
                    }
                }
            }

            // Loader: e.g. "neoforge-21.0.167" → ["neoforge", "21.0.167"].
            $mc          = $manifest['minecraft']['version'] ?? null;
            $loaders     = $manifest['minecraft']['modLoaders'] ?? [];
            $primary     = collect($loaders)->firstWhere('primary', true) ?? ($loaders[0] ?? null);
            $loaderName  = null;
            $loaderVer   = null;
            if (is_array($primary) && !empty($primary['id']) && str_contains($primary['id'], '-')) {
                [$loaderName, $loaderVer] = explode('-', $primary['id'], 2);
                $loaderName = strtolower($loaderName);
            }

            return [$overridesRoot, array_values(array_unique($fileIds)), $projectIdByFileId, $loaderName, $loaderVer, $mc];
        } finally {
            $zip->close();
        }
    }

    /** Yolks Java image the SERVER runs on. */
    private function resolveJavaImage(?string $mc): string
    {
        return $this->resolveImage($mc, 'java_images', 'default_java_image');
    }

    /** Root JDK image the loader INSTALLER runs in (must be able to write /mnt/server). */
    private function resolveLoaderImage(?string $mc): string
    {
        return $this->resolveImage($mc, 'loader_java_images', 'default_loader_image');
    }

    /** Pick a Docker image from a MC-version→image config map (descending thresholds). */
    private function resolveImage(?string $mc, string $mapKey, string $defaultKey): string
    {
        $map = config("modules.mods.installer.$mapKey", []);
        if ($mc) {
            foreach ($map as $min => $image) {
                if ($min === '*') {
                    continue;
                }
                if (version_compare($mc, $min, '>=')) {
                    return $image;
                }
            }
        }

        return $map['*'] ?? (string) config("modules.mods.installer.$defaultKey");
    }

    /** Capture a failing phase's script output for the install-log modal. */
    private function buildFailLog(string $phase, array $res): string
    {
        $log = "[{$phase}] failed.\n";
        if (!empty($res['stdout'])) {
            $log .= "--- stdout ---\n" . $res['stdout'] . "\n";
        }
        if (!empty($res['stderr'])) {
            $log .= "--- stderr ---\n" . $res['stderr'] . "\n";
        }

        return strlen($log) > 16384 ? substr($log, -16384) : $log;
    }

    /**
     * Resolve the installer jar URL for Fabric/Quilt from their meta API (the
     * script stays jq-free). Forge/NeoForge build their URL from the version.
     */
    private function resolveInstallerUrl(string $loader): ?string
    {
        $endpoint = match ($loader) {
            'fabric' => 'https://meta.fabricmc.net/v2/versions/installer',
            'quilt'  => 'https://meta.quiltmc.org/v3/versions/installer',
            default  => null,
        };

        if ($endpoint === null) {
            return null;
        }

        try {
            $data = Http::timeout(20)->get($endpoint)->json();
            return $data[0]['url'] ?? null;
        } catch (\Throwable) {
            return null;
        }
    }

    /** Full-server wipe: remove everything under /mnt/server (keeps the mount). */
    private function buildWipeScript(): string
    {
        return <<<'BASH'
#!/bin/bash
set -uo pipefail
echo "==> Wiping server files"
find /mnt/server -mindepth 1 -delete 2>/dev/null || true
echo "M12_WIPE_DONE"
BASH;
    }

    /**
     * Universal loader installer (adapted from the curseforge-generic egg). Runs in
     * a Java image; needs only curl + java. Produces unix_args.txt (Forge/NeoForge
     * 1.17+) or .serverjar (Fabric/Quilt/old Forge), matching the universal startup.
     */
    private function buildLoaderScript(string $loader, string $loaderVersion, string $mcVersion, ?string $installerUrl): string
    {
        $template = <<<'BASH'
#!/bin/bash
set -uo pipefail
cd /mnt/server || { echo "ERROR: /mnt/server missing" >&2; exit 1; }

echo "==> loader env: user=$(id -un 2>/dev/null || echo '?') uid=$(id -u 2>/dev/null || echo '?') dir=$(pwd)"

# Fail fast with a clear message if we can't write the server dir (e.g. wrong
# container user) instead of a cryptic "curl: (23) ... write" later on.
if ! ( : > .m12_write_test ) 2>/dev/null; then
  echo "ERROR: cannot write to /mnt/server as uid $(id -u 2>/dev/null) — the loader image must run as root" >&2
  exit 1
fi
rm -f .m12_write_test

# eclipse-temurin (root) may not ship curl; install it on demand.
if ! command -v curl >/dev/null 2>&1; then
  echo "==> installing curl"
  { apt-get update -y && apt-get install -y curl ca-certificates; } >/dev/null 2>&1 \
    || { echo "ERROR: could not install curl" >&2; exit 1; }
fi

LOADER=__LOADER__
LOADER_VERSION=__LOADER_VERSION__
MC_VERSION=__MC_VERSION__
INSTALLER_URL=__INSTALLER_URL__

case "$LOADER" in
  forge)
    FV="${MC_VERSION}-${LOADER_VERSION}"
    if [ "$MC_VERSION" = "1.7.10" ] || [ "$MC_VERSION" = "1.8.9" ]; then FV="${FV}-${MC_VERSION}"; fi
    URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${FV}/forge-${FV}-installer.jar"
    echo "==> Installing Forge ${FV}"
    curl -fsSL "$URL" -o forge-installer.jar || { echo "ERROR: failed to download Forge installer" >&2; exit 1; }
    rm -rf libraries/net/minecraftforge/forge/ unix_args.txt
    java -jar forge-installer.jar --installServer >/dev/null 2>&1 || { echo "ERROR: Forge installServer failed" >&2; exit 1; }
    if echo "$MC_VERSION" | grep -qE '^1\.(1[7-9]|[2-9][0-9])'; then
      ln -sf libraries/net/minecraftforge/forge/*/unix_args.txt unix_args.txt
    else
      mv "forge-${FV}.jar" forge-server-launch.jar 2>/dev/null || true
      echo "forge-server-launch.jar" > .serverjar
    fi
    rm -f forge-installer.jar
    ;;
  neoforge)
    if echo "$LOADER_VERSION" | grep -q '^1\.20\.1-'; then
      URL="https://maven.neoforged.net/releases/net/neoforged/forge/${LOADER_VERSION}/forge-${LOADER_VERSION}-installer.jar"
      ART="forge"
    else
      URL="https://maven.neoforged.net/releases/net/neoforged/neoforge/${LOADER_VERSION}/neoforge-${LOADER_VERSION}-installer.jar"
      ART="neoforge"
    fi
    echo "==> Installing NeoForge ${LOADER_VERSION}"
    curl -fsSL "$URL" -o neoforge-installer.jar || { echo "ERROR: failed to download NeoForge installer" >&2; exit 1; }
    rm -rf "libraries/net/neoforged/${ART}" unix_args.txt
    java -jar neoforge-installer.jar --installServer >/dev/null 2>&1 || { echo "ERROR: NeoForge installServer failed" >&2; exit 1; }
    ln -sf libraries/net/neoforged/${ART}/*/unix_args.txt unix_args.txt
    rm -f neoforge-installer.jar
    ;;
  fabric)
    echo "==> Installing Fabric ${LOADER_VERSION} (MC ${MC_VERSION})"
    [ -n "$INSTALLER_URL" ] || { echo "ERROR: no Fabric installer URL" >&2; exit 1; }
    curl -fsSL "$INSTALLER_URL" -o fabric-installer.jar || { echo "ERROR: failed to download Fabric installer" >&2; exit 1; }
    java -jar fabric-installer.jar server -mcversion "$MC_VERSION" -loader "$LOADER_VERSION" -downloadMinecraft \
      || { echo "ERROR: Fabric install failed" >&2; exit 1; }
    echo "fabric-server-launch.jar" > .serverjar
    rm -f fabric-installer.jar
    ;;
  quilt)
    echo "==> Installing Quilt ${LOADER_VERSION} (MC ${MC_VERSION})"
    [ -n "$INSTALLER_URL" ] || { echo "ERROR: no Quilt installer URL" >&2; exit 1; }
    curl -fsSL "$INSTALLER_URL" -o quilt-installer.jar || { echo "ERROR: failed to download Quilt installer" >&2; exit 1; }
    java -jar quilt-installer.jar install server "$MC_VERSION" "$LOADER_VERSION" --download-server --install-dir=./ \
      || { echo "ERROR: Quilt install failed" >&2; exit 1; }
    echo "quilt-server-launch.jar" > .serverjar
    rm -f quilt-installer.jar
    ;;
  *)
    echo "ERROR: unsupported loader '$LOADER'" >&2
    exit 1
    ;;
esac

echo "M12_LOADER_DONE"
BASH;

        return strtr($template, [
            '__LOADER__'         => escapeshellarg($loader),
            '__LOADER_VERSION__' => escapeshellarg($loaderVersion),
            '__MC_VERSION__'     => escapeshellarg($mcVersion),
            '__INSTALLER_URL__'  => escapeshellarg($installerUrl ?? ''),
        ]);
    }

    /**
     * Overrides step: download the pack zip on the node and extract only the
     * overrides subtree into /mnt/server. curl + unzip only.
     */
    private function buildOverridesScript(string $zipUrl, string $overridesRoot): string
    {
        $template = <<<'BASH'
#!/bin/bash
set -uo pipefail
command -v unzip >/dev/null 2>&1 || { apt-get update -y >/dev/null 2>&1 && apt-get install -y unzip >/dev/null 2>&1; }

INSTALL_DIR="/mnt/server"
ZIP_URL=__ZIP_URL__
OVERRIDES_ROOT=__OVERRIDES_ROOT__

export TMPDIR="$INSTALL_DIR/.m12_install_tmp"
rm -rf "$TMPDIR"
mkdir -p "$TMPDIR" "$INSTALL_DIR/mods"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Fetching overrides"
if curl -fL "$ZIP_URL" -o "$TMP/pack.zip"; then
  if unzip -q "$TMP/pack.zip" "$OVERRIDES_ROOT/*" -d "$TMP/x" 2>/dev/null && [ -d "$TMP/x/$OVERRIDES_ROOT" ]; then
    echo "==> Copying overrides"
    cp -r "$TMP/x/$OVERRIDES_ROOT/." "$INSTALL_DIR/"
  else
    echo "==> No overrides to copy"
  fi
  rm -rf "$TMP/pack.zip" "$TMP/x"
else
  echo "  !! could not download modpack archive for overrides (continuing)" >&2
fi

echo "OVERRIDES_DONE"
BASH;

        return strtr($template, [
            '__ZIP_URL__'        => escapeshellarg($zipUrl),
            '__OVERRIDES_ROOT__' => escapeshellarg($overridesRoot),
        ]);
    }

    /**
     * Mods batch script: download a slice of mods into /mnt/server/mods with
     * idempotency + safety. Stops at a wall-clock deadline (after >=1 mod) so the
     * call always returns under the proxy timeout.
     *
     * @param array<int, array{url: string, name: string, sha1: string}> $slice
     */
    private function buildModsBatchScript(array $slice): string
    {
        $lines = [];
        foreach ($slice as $m) {
            // Sanitize the provider-supplied filename: strip any path components and
            // disallow characters that could escape the mods/ directory (e.g. a manifest
            // fileName of "../start.sh" would otherwise be written to /mnt/server/start.sh).
            $name = preg_replace('/[^A-Za-z0-9._-]/', '_', basename($m['name']));
            if ($name === '' || $name === null || ltrim($name, '.') === '') {
                $name = 'mod-' . substr(sha1($m['url']), 0, 12) . '.jar';
            }
            $lines[] = $m['url'] . "\t" . 'mods/' . $name . "\t" . $m['sha1'];
        }
        $modlist  = implode("\n", $lines);
        $deadline = max(10, (int) config('modules.mods.installer.batch_deadline', 60));

        $template = <<<'BASH'
#!/bin/bash
set -uo pipefail
INSTALL_DIR="/mnt/server"
export TMPDIR="$INSTALL_DIR/.m12_install_tmp"
mkdir -p "$TMPDIR" "$INSTALL_DIR/mods"

DEADLINE=__DEADLINE__
START=$(date +%s)
PROC=0
OK=0
FAILED=0

while IFS=$'\t' read -r URL DEST SHA; do
  [ -z "$URL" ] && continue

  if [ "$PROC" -gt 0 ]; then
    NOW=$(date +%s)
    [ $((NOW - START)) -ge "$DEADLINE" ] && break
  fi
  PROC=$((PROC + 1))

  if [ -f "$INSTALL_DIR/$DEST" ]; then
    OK=$((OK + 1))
    continue
  fi

  if curl --retry 3 --retry-delay 2 -fsSL "$URL" -o "$INSTALL_DIR/$DEST.part"; then
    if [ -n "$SHA" ] && command -v sha1sum >/dev/null 2>&1; then
      ACTUAL=$(sha1sum "$INSTALL_DIR/$DEST.part" | cut -d' ' -f1)
      if [ "$ACTUAL" != "$SHA" ]; then
        echo "  !! sha1 mismatch: $DEST" >&2
        rm -f "$INSTALL_DIR/$DEST.part"
        FAILED=$((FAILED + 1))
        continue
      fi
    fi
    mv "$INSTALL_DIR/$DEST.part" "$INSTALL_DIR/$DEST"
    echo "  -> $DEST"
    OK=$((OK + 1))
  else
    echo "  !! failed: $DEST" >&2
    rm -f "$INSTALL_DIR/$DEST.part"
    FAILED=$((FAILED + 1))
  fi
done <<'MODLIST'
__MODLIST__
MODLIST

echo "M12_BATCH_DONE processed=$PROC installed=$OK failed=$FAILED"
BASH;

        return strtr($template, [
            '__DEADLINE__' => (string) $deadline,
            '__MODLIST__'  => $modlist,
        ]);
    }

    /** Stream-download a URL to a local path. */
    private function downloadFile(string $url, string $destPath): void
    {
        $handle = fopen($destPath, 'w');
        if (!$handle) {
            throw new \RuntimeException('Failed to create temp file for modpack download.');
        }

        try {
            $response = Http::withHeaders([
                'User-Agent' => 'M12Labs/1.0 (github.com/m12labs/m12labs)',
                'Accept'     => '*/*',
            ])
                ->timeout(120)
                ->sink($handle)
                ->get($url);

            if (!$response->successful()) {
                throw new \RuntimeException('Failed to download modpack archive. HTTP ' . $response->status());
            }
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
        }
    }

    /**
     * Parse "M12_BATCH_DONE processed=P installed=X failed=Y".
     *
     * @return array{0: int, 1: int, 2: int} [processed, installed, failed]
     */
    private function parseBatch(string $stdout): array
    {
        if (preg_match('/' . self::BATCH_SENTINEL . '\s+processed=(\d+)\s+installed=(\d+)\s+failed=(\d+)/', $stdout, $m)) {
            return [(int) $m[1], (int) $m[2], (int) $m[3]];
        }

        return [0, 0, 0];
    }

    /**
     * Build the final install log: a short summary + loader/wipe notes + the
     * blocked-mod report.
     *
     * @param string[] $blocked
     * @param string[] $clientSideOnly
     * @param string[] $notes
     */
    private function buildLog(int $total, int $failed, array $blocked, array $clientSideOnly, array $notes): string
    {
        $installed = max(0, $total - $failed);
        $lines = [];
        foreach ($notes as $n) {
            $lines[] = $n;
        }
        $line = "Installed {$installed} of {$total} mods.";
        if ($failed > 0) {
            $line .= " {$failed} could not be downloaded.";
        }
        $lines[] = $line;
        $log = implode("\n", $lines);

        if (!empty($blocked)) {
            $log .= "\n\n--- Skipped (author disabled distribution) ---\n  - " . implode("\n  - ", $blocked);
        }

        if (!empty($clientSideOnly)) {
            $log .= "\n\n--- Skipped (client-side only) ---\n  - " . implode("\n  - ", $clientSideOnly);
        }

        if (strlen($log) > 16384) {
            $log = substr($log, 0, 16384) . '…(truncated)';
        }

        return $log;
    }

    private function firstError(string $stderr): string
    {
        foreach (explode("\n", trim($stderr)) as $line) {
            $line = trim($line);
            if ($line !== '') {
                return $line;
            }
        }

        return '';
    }

    private function recordAudit($server, string $status): void
    {
        MarketplaceInstallLog::create([
            'provider'        => 'curseforge',
            'type'            => 'modpack',
            'project_id'      => (string) $this->parent->project_id,
            'file_size_bytes' => 0,
            'status'          => $status,
            'server_id'       => $server->id,
            'user_id'         => $this->parent->user_id,
        ]);
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('InstallModpackJob infrastructure failure', [
            'parent_id' => $this->parent->id,
            'error'     => $exception->getMessage(),
        ]);

        $this->parent->update([
            'status'        => DownloadQueue::STATUS_FAILED,
            'error_message' => 'Modpack install worker encountered an unexpected error.',
            'completed_at'  => now(),
        ]);
    }
}
