<?php

namespace Everest\Services\Helpers;

use Exception;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Http;
use Illuminate\Contracts\Cache\Repository as CacheRepository;

class SoftwareVersionService
{
    public const VERSION_CACHE_KEY = 'm12labs:release_data';
    public const GIT_VERSION_CACHE_KEY = 'pterodactyl:git_data';

    private static array $result;

    /**
     * SoftwareVersionService constructor.
     */
    public function __construct(private CacheRepository $cache)
    {
        self::$result = $this->cacheVersionData();
    }

    /**
     * Return the current version of the panel that is being used.
     */
    public function getCurrentVersion(): string
    {
        return config('app.version');
    }

    /**
     * Latest published release tag of this panel (from the configured GitHub
     * releases feed), or null when no release has been published / the feed
     * is unreachable.
     */
    public function getLatestPanel(): ?string
    {
        return Arr::get(self::$result, 'tag_name');
    }

    /**
     * Determine if the current version of the panel is the latest. This is a
     * quiet check: when there is nothing meaningful to compare against — no
     * published release, an unreachable feed, or a version string without a
     * numeric core — the panel is treated as up to date rather than nagging.
     */
    public function isLatestPanel(): bool
    {
        $version = $this->getCurrentVersion();
        if ($version === 'canary') {
            return true;
        }

        $current = $this->numericCore($version);
        $latest = $this->numericCore($this->getLatestPanel());
        if ($current === null || $latest === null) {
            return true;
        }

        return version_compare($current, $latest) >= 0;
    }

    /**
     * Determine if a passed daemon version string is the latest. The release
     * feed only tracks the panel, so this is always quietly true.
     */
    public function isLatestWings(string $version): bool
    {
        return true;
    }

    /**
     * Extract the dotted numeric core of a version string, so human-styled
     * versions ("Alpha 3.0") and tag-styled releases ("v3.1.0-alpha") compare
     * on equal footing. Returns null when the string has no digits to compare.
     */
    private function numericCore(?string $version): ?string
    {
        if ($version === null) {
            return null;
        }

        return preg_match('/\d+(?:\.\d+)*/', $version, $matches) ? $matches[0] : null;
    }

    /**
     * ?
     */
    public function getVersionData(): array
    {
        $versionData = $this->versionData();
        if ($versionData['is_git']) {
            $git = $versionData['version'];
        } else {
            $git = null;
        }

        return [
            'panel' => [
                'current' => $this->getCurrentVersion(),
                'latest' => $this->getLatestPanel(),
            ],

            'git' => $git,
        ];
    }

    /**
     * Return version information for the footer.
     */
    protected function versionData(): array
    {
        return $this->cache->remember(self::GIT_VERSION_CACHE_KEY, CarbonImmutable::now()->addSeconds(15), function () {
            $configVersion = $this->getCurrentVersion();

            if (file_exists(base_path('.git/HEAD'))) {
                $head = explode(' ', file_get_contents(base_path('.git/HEAD')));

                if (array_key_exists(1, $head)) {
                    $path = base_path('.git/' . trim($head[1]));
                }
            }

            if (isset($path) && file_exists($path)) {
                return [
                    'version' => substr(file_get_contents($path), 0, 8),
                    'is_git' => true,
                ];
            }

            return [
                'version' => $configVersion,
                'is_git' => false,
            ];
        });
    }

    /**
     * Fetch and cache the latest published release from the configured GitHub
     * releases endpoint. Any failure (no releases yet, rate limit, network)
     * caches an empty payload so the panel stays quiet instead of erroring.
     */
    protected function cacheVersionData(): array
    {
        return $this->cache->remember(self::VERSION_CACHE_KEY, CarbonImmutable::now()->addMinutes(config('everest.releases.cache_time', 60)), function () {
            try {
                $response = Http::acceptJson()
                    ->withHeaders(['X-GitHub-Api-Version' => '2022-11-28'])
                    ->timeout(5)
                    ->get(config('everest.releases.url'));

                if ($response->status() === 200 && is_string($response->json('tag_name'))) {
                    return ['tag_name' => $response->json('tag_name')];
                }
            } catch (Exception) {
                // fall through to the quiet empty payload
            }

            return [];
        });
    }
}
