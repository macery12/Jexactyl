<?php

namespace Everest\Services\Mods;

use Everest\Models\Setting;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\RequestException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Everest\Exceptions\Service\Mods\ModsServiceException;

/**
 * CurseForge API client. Powers modpacks only — individual mods/plugins are
 * served by ModrinthService. The API key is stored encrypted in settings and
 * read at runtime (never sourced from plaintext config).
 */
class CurseForgeService
{
    /** Minecraft game id on CurseForge. */
    private const GAME_ID = 432;

    /** Modpack class id on CurseForge (mods are 6). */
    private const MODPACK_CLASS_ID = 4471;

    /** Loader slug => CurseForge modLoaderType numeric id. */
    private const LOADER_TYPE_MAP = [
        'forge'    => 1,
        'fabric'   => 4,
        'quilt'    => 5,
        'neoforge' => 6,
    ];

    /** Lowercased loader names that may appear in a file's gameVersions list. */
    private const LOADER_NAMES = ['forge', 'neoforge', 'fabric', 'quilt'];

    private Client $client;
    private string $apiKey;
    private string $endpoint;
    private int $requestsPerMinute;
    private int $requestsPerHour;
    private bool $cacheEnabled;
    private array $cacheTtl;
    private bool $cdnFallbackEnabled;

    public function __construct()
    {
        $this->apiKey = (string) Setting::get('settings::modules:mods:curseforge_api_key', '');
        $this->endpoint = config('modules.mods.curseforge_api_url') ?: 'https://api.curseforge.com/v1';
        $this->requestsPerMinute = (int) config('modules.mods.rate_limit.requests_per_minute', 30);
        $this->requestsPerHour = (int) config('modules.mods.rate_limit.requests_per_hour', 1800);
        $this->cacheEnabled = (bool) config('modules.mods.cache.enabled', true);
        $this->cdnFallbackEnabled = (bool) \Everest\Models\Setting::get(
            'settings::modules:mods:curseforge_cdn_fallback',
            config('modules.mods.curseforge_cdn_fallback', true)
        );
        $this->cacheTtl = config('modules.mods.cache.ttl', [
            'search' => 300,
            'mod_details' => 1800,
            'mod_files' => 600,
            'versions' => 3600,
            'loaders' => 3600,
        ]);

        $this->client = new Client([
            'base_uri' => rtrim($this->endpoint, '/') . '/',
            'timeout'  => 30,
        ]);
    }

    /**
     * Map a loader slug (forge, neoforge, fabric, quilt) to CurseForge's numeric
     * modLoaderType, or null if unknown.
     */
    public static function loaderTypeId(?string $slug): ?int
    {
        return $slug ? (self::LOADER_TYPE_MAP[strtolower($slug)] ?? null) : null;
    }

    public function isConfigured(): bool
    {
        return $this->apiKey !== '';
    }

    /**
     * Enforce a Cache-based rate limit before each outbound request.
     *
     * @throws ModsServiceException
     */
    private function checkRateLimit(): void
    {
        $minute = (int) Cache::get('curseforge_rate_limit_minute', 0);
        $hour   = (int) Cache::get('curseforge_rate_limit_hour', 0);

        if ($minute >= $this->requestsPerMinute) {
            throw new ModsServiceException('CurseForge API rate limit exceeded (per minute). Please try again shortly.');
        }
        if ($hour >= $this->requestsPerHour) {
            throw new ModsServiceException('CurseForge API rate limit exceeded (per hour). Please try again later.');
        }

        Cache::put('curseforge_rate_limit_minute', $minute + 1, 60);
        Cache::put('curseforge_rate_limit_hour', $hour + 1, 3600);
    }

    /**
     * Issue a request to the CurseForge API.
     *
     * @throws ModsServiceException
     */
    private function makeRequest(string $method, string $path, array $params = [], int $retryAttempt = 0): array
    {
        if ($this->apiKey === '') {
            throw new ModsServiceException('CurseForge API key is not configured.');
        }

        $this->checkRateLimit();

        try {
            $options = [
                'headers' => [
                    'Accept'    => 'application/json',
                    'x-api-key' => $this->apiKey,
                ],
            ];

            if (!empty($params)) {
                $options[$method === 'GET' ? 'query' : 'json'] = $params;
            }

            $response = $this->client->request($method, $path, $options);
            $data = json_decode($response->getBody()->getContents(), true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new ModsServiceException('Failed to decode CurseForge API response.');
            }

            return $data;
        } catch (GuzzleException $e) {
            if ($e instanceof RequestException && $e->hasResponse()) {
                $status = $e->getResponse()->getStatusCode();

                if ($status === 429 && $retryAttempt < 3) {
                    sleep(mt_rand(3, 8));

                    return $this->makeRequest($method, $path, $params, $retryAttempt + 1);
                }
                if ($status === 429) {
                    throw new ModsServiceException('CurseForge API rate limit (429) exceeded after retries.');
                }
                if ($status === 401 || $status === 403) {
                    throw new ModsServiceException('Invalid CurseForge API key.');
                }
            }

            Log::error('CurseForge API request failed: ' . $e->getMessage());
            throw new ModsServiceException('Failed to connect to CurseForge API: ' . $e->getMessage());
        }
    }

    /**
     * Cache wrapper that coalesces concurrent identical requests.
     *
     * @throws ModsServiceException
     */
    private function makeCachedRequest(string $cacheKey, int $ttl, callable $callback): array
    {
        if (!$this->cacheEnabled) {
            return $callback();
        }

        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        $data = $callback();
        Cache::put($cacheKey, $data, $ttl);

        return $data;
    }

    /**
     * Search modpacks. Accepts: searchFilter, sortField, sortOrder, gameVersion,
     * modLoaderType, pageSize, index. Returns the CurseForge { data, pagination }
     * envelope (already matches the frontend Mod shape).
     *
     * @throws ModsServiceException
     */
    public function searchModpacks(array $params = []): array
    {
        $searchParams = array_merge([
            'gameId'   => self::GAME_ID,
            'classId'  => self::MODPACK_CLASS_ID,
            'pageSize' => min($params['pageSize'] ?? 20, (int) config('modules.mods.max_page_size', 50)),
        ], array_filter([
            'searchFilter'  => $params['searchFilter'] ?? null,
            'sortField'     => $params['sortField'] ?? null,
            'sortOrder'     => $params['sortOrder'] ?? null,
            'gameVersion'   => $params['gameVersion'] ?? null,
            'modLoaderType' => $params['modLoaderType'] ?? null,
            'index'         => $params['index'] ?? null,
        ], fn ($v) => $v !== null && $v !== ''));

        $cacheKey = 'curseforge_modpack_search_' . md5(json_encode($searchParams));

        return $this->makeCachedRequest($cacheKey, $this->cacheTtl['search'], function () use ($searchParams) {
            return $this->makeRequest('GET', 'mods/search', $searchParams);
        });
    }

    /**
     * Get a single modpack project.
     *
     * @throws ModsServiceException
     */
    public function getModpack(int $modpackId): array
    {
        $cacheKey = "curseforge_modpack_{$modpackId}";

        return $this->makeCachedRequest($cacheKey, $this->cacheTtl['mod_details'], function () use ($modpackId) {
            return $this->makeRequest('GET', 'mods/' . $modpackId);
        });
    }

    /**
     * List a modpack's files, normalized to the wizard's version shape and
     * optionally filtered by game version + loader.
     *
     * @throws ModsServiceException
     */
    public function getModpackVersions(int $modpackId, ?string $gameVersion = null, ?int $modLoaderType = null): array
    {
        $fileParams = array_filter([
            'gameVersion'   => $gameVersion,
            'modLoaderType' => $modLoaderType,
            'pageSize'      => 50,
            'index'         => 0,
        ], fn ($v) => $v !== null);

        $cacheKey = "curseforge_modpack_files_{$modpackId}_" . md5(json_encode($fileParams));

        $response = $this->makeCachedRequest($cacheKey, $this->cacheTtl['mod_files'], function () use ($modpackId, $fileParams) {
            return $this->makeRequest('GET', 'mods/' . $modpackId . '/files', $fileParams);
        });

        return array_map(fn (array $file) => $this->normalizeVersion($file), $response['data'] ?? []);
    }

    /**
     * Return the list of release Minecraft versions, newest first. Heavily
     * cached — the version list rarely changes.
     *
     * @return string[]
     * @throws ModsServiceException
     */
    public function getMinecraftVersions(): array
    {
        $data = $this->makeCachedRequest('curseforge_mc_versions', 86400, function () {
            return $this->makeRequest('GET', 'minecraft/version');
        });

        $versions = [];
        foreach ($data['data'] ?? [] as $v) {
            $s = $v['versionString'] ?? '';
            // Keep release versions only (e.g. 1.20.1) — skip snapshots/pre-releases.
            if ($s !== '' && preg_match('/^\d+\.\d+(\.\d+)?$/', $s)) {
                $versions[] = $s;
            }
        }

        return array_values(array_unique($versions));
    }

    /**
     * The newest release Minecraft version, or null if unavailable.
     *
     * @throws ModsServiceException
     */
    public function latestMinecraftVersion(): ?string
    {
        return $this->getMinecraftVersions()[0] ?? null;
    }

    /**
     * Fetch a single modpack file (used to resolve the .zip download URL).
     *
     * @throws ModsServiceException
     */
    public function getModpackFile(int $modpackId, int $fileId): array
    {
        $response = $this->makeRequest('GET', 'mods/' . $modpackId . '/files/' . $fileId);

        return $response['data'] ?? [];
    }

    /**
     * Bulk-fetch the serverSide value for a set of project (mod) IDs.
     * Returns a map: projectId => serverSide (0=Unknown, 1=Required, 2=Optional, 3=Unsupported).
     * Missing IDs default to 0 (Unknown) at the call-site.
     *
     * @param int[] $projectIds
     * @return array<int, int>
     * @throws ModsServiceException
     */
    public function getModsServerSide(array $projectIds): array
    {
        $projectIds = array_values(array_unique(array_map('intval', $projectIds)));
        if (empty($projectIds)) {
            return [];
        }

        $result = [];
        foreach (array_chunk($projectIds, 50) as $chunk) {
            $response = $this->makeRequest('POST', 'mods', ['modIds' => $chunk]);
            foreach ($response['data'] ?? [] as $mod) {
                $id = (int) ($mod['id'] ?? 0);
                if ($id !== 0) {
                    $result[$id] = (int) ($mod['serverSide'] ?? 0);
                }
            }
        }

        return $result;
    }

    /**
     * Bulk-resolve file metadata for a set of file ids (manifest entries).
     * Returns a map: fileId => [modId, file_name, file_length, download_url|null, sha1].
     *
     * @param int[] $fileIds
     * @return array<int, array>
     * @throws ModsServiceException
     */
    public function resolveFiles(array $fileIds): array
    {
        $fileIds = array_values(array_unique(array_map('intval', $fileIds)));
        if (empty($fileIds)) {
            return [];
        }

        $resolved = [];

        // CurseForge caps the bulk endpoint; chunk to stay well within limits.
        foreach (array_chunk($fileIds, 200) as $chunk) {
            $response = $this->makeRequest('POST', 'mods/files', ['fileIds' => $chunk]);

            foreach ($response['data'] ?? [] as $file) {
                $id = (int) ($file['id'] ?? 0);
                if ($id === 0) {
                    continue;
                }

                $fileName = $file['fileName'] ?? '';
                $apiUrl   = $file['downloadUrl'] ?? null;

                $resolved[$id] = [
                    'mod_id'       => (int) ($file['modId'] ?? 0),
                    'file_name'    => $fileName,
                    'file_length'  => (int) ($file['fileLength'] ?? 0),
                    'download_url' => $apiUrl ?? ($this->cdnFallbackEnabled ? $this->buildCdnFallbackUrl($id, $fileName) : null),
                    'sha1'         => $this->extractSha1($file['hashes'] ?? []),
                ];
            }
        }

        return $resolved;
    }

    /**
     * Normalize a CurseForge file object into the wizard's version shape.
     */
    private function normalizeVersion(array $file): array
    {
        $gameVersions = [];
        $loaders      = [];

        foreach ($file['gameVersions'] ?? [] as $gv) {
            $lower = strtolower((string) $gv);
            if (in_array($lower, self::LOADER_NAMES, true)) {
                $loaders[] = $lower;
            } elseif (preg_match('/^\d/', (string) $gv)) {
                $gameVersions[] = (string) $gv;
            }
        }

        $releaseMap = [1 => 'release', 2 => 'beta', 3 => 'alpha'];

        return [
            'id'            => (int) ($file['id'] ?? 0),
            'name'          => $file['displayName'] ?? ($file['fileName'] ?? ''),
            'file_name'     => $file['fileName'] ?? '',
            'release_type'  => $releaseMap[$file['releaseType'] ?? 1] ?? 'release',
            'game_versions' => array_values(array_unique($gameVersions)),
            'loaders'       => array_values(array_unique($loaders)),
            'date_published' => $file['fileDate'] ?? '',
            'download_url'  => $file['downloadUrl'] ?? null,
            'file_length'   => (int) ($file['fileLength'] ?? 0),
        ];
    }

    /**
     * Construct a direct CDN URL for files where the author disabled third-party distribution
     * (API returns null downloadUrl). CurseForge file IDs encode the CDN path:
     *   floor(id/1000) / (id%1000) / fileName
     * Returns null if the filename is missing (API bug — cannot build a valid URL).
     */
    private function buildCdnFallbackUrl(int $fileId, string $fileName): ?string
    {
        if ($fileName === '') {
            return null;
        }

        return sprintf(
            'https://mediafilez.forgecdn.net/files/%d/%d/%s',
            intdiv($fileId, 1000),
            $fileId % 1000,
            rawurlencode($fileName)
        );
    }

    /**
     * Extract the SHA1 hash (algo == 1) from a CurseForge hashes array.
     */
    private function extractSha1(array $hashes): string
    {
        foreach ($hashes as $hash) {
            if ((int) ($hash['algo'] ?? 0) === 1) {
                return strtolower((string) ($hash['value'] ?? ''));
            }
        }

        return '';
    }
}
