<?php

namespace Everest\Services\Mods;

use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\RequestException;
use Everest\Exceptions\Service\Mods\ModsServiceException;

class ModrinthService
{
    private Client $client;
    private string $endpoint;
    private bool $cacheEnabled;
    private array $cacheTtl;
    private float $requestDelaySeconds = 0.2; // Modrinth has higher rate limits
    private int $rateLimitPerMinute = 300; // 300 requests per minute for Modrinth
    private array $pluginPlatforms = [
        'paper',
        'purpur',
        'spigot',
        'bukkit',
        'folia',
        'velocity',
        'waterfall',
        'sponge',
    ];
    private array $pluginLoaderFacets = [
        'paper',
        'spigot',
        'bukkit',
        'purpur',
        'folia',
    ];

    /**
     * ModrinthService constructor.
     */
    public function __construct()
    {
        $this->endpoint = config('modules.mods.modrinth_api_url') ?: 'https://api.modrinth.com/v2';
        $this->cacheEnabled = config('modules.mods.cache.enabled', true);

        $this->cacheTtl = config('modules.mods.cache.ttl', [
            'search' => 86400,      // 24 hours
            'mod_details' => 86400, // 24 hours
            'mod_files' => 86400,   // 24 hours
            'versions' => 86400,    // 24 hours
            'loaders' => 86400,     // 24 hours
        ]);

        $this->client = new Client([
            'base_uri' => rtrim($this->endpoint, '/') . '/',
            'timeout' => 30,
        ]);
    }

    /**
     * Simple throttling for Modrinth API.
     */
    private function simpleThrottle(): void
    {
        $lastRequestKey = 'modrinth_last_request_time';
        $lastRequestTime = Cache::get($lastRequestKey, 0);
        $now = microtime(true);

        $timeSinceLastRequest = $now - $lastRequestTime;

        // Wait if we haven't waited long enough
        if ($timeSinceLastRequest < $this->requestDelaySeconds) {
            $sleepTime = $this->requestDelaySeconds - $timeSinceLastRequest;
            usleep((int) ($sleepTime * 1000000));
        }

        // Update last request time
        Cache::put($lastRequestKey, microtime(true), 3600);
    }

    /**
     * Check rate limit for Modrinth API (300 req/min).
     *
     * @throws ModsServiceException
     */
    private function checkRateLimit(): void
    {
        $counterKey = 'modrinth_requests_this_minute';
        $count = Cache::get($counterKey, 0);

        if ($count >= $this->rateLimitPerMinute) {
            throw new ModsServiceException('Modrinth API rate limit reached. Please wait a minute before trying again.');
        }
    }

    /**
     * Track a request for rate limiting purposes.
     */
    private function trackRequest(): void
    {
        $counterKey = 'modrinth_requests_this_minute';
        $count = Cache::get($counterKey, 0) + 1;

        // Store count with 60 second expiry
        Cache::put($counterKey, $count, 60);
    }

    /**
     * Make a request to the Modrinth API.
     *
     * @throws ModsServiceException
     */
    private function makeRequest(string $method, string $path, array $params = []): array
    {
        // Check rate limit
        $this->checkRateLimit();

        // Simple throttling
        $this->simpleThrottle();

        try {
            $options = [
                'headers' => [
                    'Accept' => 'application/json',
                    'User-Agent' => 'M12Labs/1.0 (github.com/m12labs/m12labs)',
                ],
            ];

            if (!empty($params)) {
                if ($method === 'GET') {
                    $options['query'] = $params;
                } else {
                    $options['json'] = $params;
                }
            }

            $response = $this->client->request($method, $path, $options);

            $statusCode = $response->getStatusCode();
            $body = $response->getBody()->getContents();
            $data = json_decode($body, true);

            if (json_last_error() !== JSON_ERROR_NONE) {
                Log::error('Modrinth API JSON decode error: ' . json_last_error_msg());
                throw new ModsServiceException('Failed to decode Modrinth API response.');
            }

            // Track request for rate limiting
            $this->trackRequest();

            return $data;
        } catch (GuzzleException $e) {
            if ($e instanceof RequestException && $e->hasResponse()) {
                $statusCode = $e->getResponse()->getStatusCode();

                if ($statusCode === 429) {
                    throw new ModsServiceException('Modrinth API rate limit exceeded. Please wait before trying again.');
                } elseif ($statusCode === 400) {
                    throw new ModsServiceException('Invalid request parameters for Modrinth API.');
                } elseif ($statusCode === 404) {
                    throw new ModsServiceException('Mod not found on Modrinth.');
                }
            }

            Log::error('Modrinth API request failed: ' . $e->getMessage());
            throw new ModsServiceException('Failed to connect to Modrinth API: ' . $e->getMessage());
        }
    }

    /**
     * Make a cached request to the Modrinth API.
     *
     * @throws ModsServiceException
     */
    private function makeCachedRequest(string $cacheKey, int $ttl, callable $requestCallback): array
    {
        if (!$this->cacheEnabled) {
            return $requestCallback();
        }

        // Check if cached data exists
        $cached = Cache::get($cacheKey);
        if ($cached !== null) {
            return $cached;
        }

        // Execute the request
        $data = $requestCallback();

        // Only cache if data size is reasonable (< 1MB when serialized)
        $serialized = serialize($data);
        $sizeInBytes = strlen($serialized);
        $maxCacheSize = 1048576; // 1MB limit

        if ($sizeInBytes < $maxCacheSize) {
            try {
                Cache::put($cacheKey, $data, $ttl);
            } catch (\Exception $e) {
                Log::warning("Failed to cache Modrinth response (size: {$sizeInBytes} bytes): " . $e->getMessage());
            }
        } else {
            Log::warning("Modrinth response too large to cache: {$sizeInBytes} bytes");
        }

        return $data;
    }

    /**
     * Search for mods in the Modrinth database.
     *
     * @param array $params Search parameters
     *
     * @throws ModsServiceException
     */
    public function searchMods(array $params = []): array
    {
        $projectType = ($params['resource'] ?? 'mods') === 'plugins' ? 'plugin' : 'mod';
        $searchParams = [
            'limit' => min($params['pageSize'] ?? 20, config('modules.mods.max_page_size', 50)),
            'offset' => $params['index'] ?? 0,
        ];

        // Add query if search filter provided
        if (!empty($params['searchFilter'])) {
            $searchParams['query'] = $params['searchFilter'];
        }

        // Build facets array for filtering
        $facets = [];

        // Always filter for Minecraft mods/plugins
        $facets[] = ['project_type:' . $projectType];

        // Restrict plugin searches to server-side required projects
        if ($projectType === 'plugin') {
            $facets[] = ['server_side:required'];
        }

        // Add game version facet if provided
        if (!empty($params['gameVersion'])) {
            $facets[] = ['versions:' . $params['gameVersion']];
        }

        // Add loader facet if provided (map numeric loader type IDs to Modrinth loader names)
        if ($projectType === 'mod' && !empty($params['modLoaderType'])) {
            $loaderMap = [
                1 => 'forge',
                2 => 'cauldron',
                3 => 'liteloader',
                4 => 'fabric',
                5 => 'quilt',
                6 => 'neoforge',
            ];

            if (isset($loaderMap[$params['modLoaderType']])) {
                $facets[] = ['categories:' . $loaderMap[$params['modLoaderType']]];
            }
        }

        if ($projectType === 'plugin') {
            // Always restrict plugin searches to server-side plugin loader categories
            $platformFacets = $this->filterPluginLoaderPlatforms($params['platform'] ?? null);
            $facets[] = array_map(static fn ($p) => 'categories:' . $p, $platformFacets);
        }

        // $facets is always initialized with at least the project_type filter.
        $searchParams['facets'] = json_encode($facets);

        // Map numeric sort field IDs to Modrinth index values
        if (!empty($params['sortField'])) {
            $sortMap = [
                '1' => 'relevance',  // Featured
                '2' => 'downloads',  // Popularity
                '3' => 'updated',    // Last Updated
                '4' => 'name',       // Name
                '5' => 'author',     // Author
                '6' => 'downloads',  // Total Downloads
            ];

            $modrinthIndex = $sortMap[$params['sortField']] ?? 'relevance';
            $searchParams['index'] = $modrinthIndex;
        }

        // Create cache key based on search parameters
        $cacheKey = 'modrinth_search_' . md5(json_encode($searchParams));

        $response = $this->makeCachedRequest($cacheKey, $this->cacheTtl['search'], function () use ($searchParams) {
            return $this->makeRequest('GET', 'search', $searchParams);
        });

        $filtersMeta = $projectType === 'plugin' ? $this->getPluginFiltersMetadata() : null;

        return $this->transformSearchResponse($response, $searchParams, $filtersMeta);
    }

    /**
     * Transform Modrinth search response to the common marketplace format.
     */
    private function transformSearchResponse(array $response, array $searchParams, ?array $filtersMeta = null): array
    {
        $hits = $response['hits'] ?? [];
        $totalHits = $response['total_hits'] ?? 0;

        $transformedMods = array_map(function ($hit) {
            return $this->transformModToCommonFormat($hit);
        }, $hits);

        $result = [
            'data' => $transformedMods,
            'pagination' => [
                'index' => $searchParams['offset'] ?? 0,
                'pageSize' => $searchParams['limit'] ?? 20,
                'resultCount' => count($transformedMods),
                'totalCount' => $totalHits,
            ],
        ];

        if ($filtersMeta) {
            $result['filters'] = $filtersMeta;
        }

        return $result;
    }

    /**
     * Filters metadata for plugin searches.
     */
    private function getPluginFiltersMetadata(): array
    {
        $sortOptions = [
            ['id' => '1', 'label' => 'Featured'],
            ['id' => '2', 'label' => 'Popularity'],
            ['id' => '3', 'label' => 'Last Updated'],
            ['id' => '4', 'label' => 'Name'],
            ['id' => '5', 'label' => 'Author'],
            ['id' => '6', 'label' => 'Total Downloads'],
        ];

        $platforms = array_map(
            fn (string $platform) => ['id' => $platform, 'name' => ucfirst($platform)],
            $this->pluginPlatforms
        );

        return [
            'supported' => [
                'search' => true,
                'sort' => array_column($sortOptions, 'id'),
                'platform' => true,
            ],
            'unsupported' => [
                'modLoader' => 'Mod loaders are not applicable for plugins.',
                'category' => 'Categories are mapped via platform tags for plugins.',
            ],
            'options' => [
                'sortBy' => $sortOptions,
                'platforms' => $platforms,
            ],
        ];
    }

    /**
     * Normalize platform inputs to allowed lowercase list.
     *
     * @param array|string $platforms
     * @return array<int, string>
     */
    private function normalizePlatforms(array|string|null $platforms): array
    {
        $platformList = [];
        if (is_array($platforms)) {
            $platformList = $platforms;
        } elseif ($platforms !== null) {
            $platformList = [$platforms];
        }

        $normalized = array_map(static fn ($p) => strtolower((string) $p), $platformList);
        $valid = array_filter($normalized, fn ($p) => in_array($p, $this->pluginPlatforms, true));

        return array_values(array_unique($valid));
    }

    /**
     * Return only plugin loader platforms, defaulting to the recommended set.
     *
     * @param array|string|null $platforms
     * @return array<int, string>
     */
    private function filterPluginLoaderPlatforms(array|string|null $platforms): array
    {
        $normalized = $this->normalizePlatforms($platforms);
        $loaderPlatforms = array_values(array_intersect($normalized, $this->pluginLoaderFacets));

        return !empty($loaderPlatforms) ? $loaderPlatforms : $this->pluginLoaderFacets;
    }

    /**
     * Transform a Modrinth mod object to the common marketplace format.
     */
    private function transformModToCommonFormat(array $modrinthMod): array
    {
        $projectType = $modrinthMod['project_type'] ?? 'mod';
        $slug = $modrinthMod['slug'] ?? '';
        $typePath = $projectType === 'plugin' ? 'plugin' : 'mod';

        return [
            'id' => $modrinthMod['project_id'] ?? $modrinthMod['id'] ?? '',
            'gameId' => 432, // Minecraft
            'name' => $modrinthMod['title'] ?? '',
            'slug' => $slug,
            'links' => [
                'websiteUrl' => "https://modrinth.com/{$typePath}/" . $slug,
                'wikiUrl' => $modrinthMod['wiki_url'] ?? '',
                'issuesUrl' => $modrinthMod['issues_url'] ?? '',
                'sourceUrl' => $modrinthMod['source_url'] ?? '',
            ],
            'summary' => $modrinthMod['description'] ?? '',
            'status' => 4, // Approved
            'downloadCount' => $modrinthMod['downloads'] ?? 0,
            'isFeatured' => array_key_exists('featured_gallery', $modrinthMod)
                ? $modrinthMod['featured_gallery'] !== null
                : false,
            'primaryCategoryId' => 0,
            'categories' => $modrinthMod['categories'] ?? [],
            'classId' => 6, // Mods
            'authors' => [
                [
                    'id' => 0,
                    'name' => $modrinthMod['author'] ?? 'Unknown',
                    'url' => '',
                ],
            ],
            'logo' => [
                'id' => 0,
                'modId' => $modrinthMod['project_id'] ?? '',
                'title' => $modrinthMod['title'] ?? '',
                'description' => '',
                'thumbnailUrl' => $modrinthMod['icon_url'] ?? '',
                'url' => $modrinthMod['icon_url'] ?? '',
            ],
            'screenshots' => [],
            'mainFileId' => 0,
            'latestFiles' => [],
            'latestFilesIndexes' => [],
            'dateCreated' => $modrinthMod['date_created'] ?? '',
            'dateModified' => $modrinthMod['date_modified'] ?? '',
            'dateReleased' => $modrinthMod['date_created'] ?? '',
            'allowModDistribution' => true,
            'gamePopularityRank' => 0,
        ];
    }

    /**
     * Get details of a specific mod.
     *
     * @param string $modId Modrinth project ID or slug
     *
     * @throws ModsServiceException
     */
    public function getMod(string $modId): array
    {
        $cacheKey = "modrinth_mod_{$modId}";

        $response = $this->makeCachedRequest($cacheKey, $this->cacheTtl['mod_details'], function () use ($modId) {
            return $this->makeRequest('GET', 'project/' . $modId);
        });

        // Transform to common format and wrap in data property
        return [
            'data' => $this->transformModDetailsToCommonFormat($response),
        ];
    }

    /**
     * Transform a detailed Modrinth project to the common marketplace format.
     */
    private function transformModDetailsToCommonFormat(array $modrinthMod): array
    {
        $projectType = $modrinthMod['project_type'] ?? 'mod';
        $slug = $modrinthMod['slug'] ?? '';
        $typePath = $projectType === 'plugin' ? 'plugin' : 'mod';

        return [
            'id' => $modrinthMod['id'] ?? '',
            'gameId' => 432,
            'name' => $modrinthMod['title'] ?? '',
            'slug' => $slug,
            'links' => [
                'websiteUrl' => "https://modrinth.com/{$typePath}/" . $slug,
                'wikiUrl' => $modrinthMod['wiki_url'] ?? '',
                'issuesUrl' => $modrinthMod['issues_url'] ?? '',
                'sourceUrl' => $modrinthMod['source_url'] ?? '',
            ],
            'summary' => $modrinthMod['description'] ?? '',
            'status' => 4,
            'downloadCount' => $modrinthMod['downloads'] ?? 0,
            'isFeatured' => !empty($modrinthMod['gallery']),
            'primaryCategoryId' => 0,
            'categories' => $modrinthMod['categories'] ?? [],
            'classId' => 6,
            'authors' => array_map(function ($member) {
                return [
                    'id' => 0,
                    'name' => $member['user']['username'] ?? 'Unknown',
                    'url' => '',
                ];
            }, $modrinthMod['members'] ?? []),
            'logo' => [
                'id' => 0,
                'modId' => $modrinthMod['id'] ?? '',
                'title' => $modrinthMod['title'] ?? '',
                'description' => '',
                'thumbnailUrl' => $modrinthMod['icon_url'] ?? '',
                'url' => $modrinthMod['icon_url'] ?? '',
            ],
            'screenshots' => array_map(function ($image) {
                return [
                    'id' => 0,
                    'modId' => 0,
                    'title' => $image['title'] ?? '',
                    'description' => $image['description'] ?? '',
                    'thumbnailUrl' => $image['url'] ?? '',
                    'url' => $image['url'] ?? '',
                ];
            }, $modrinthMod['gallery'] ?? []),
            'mainFileId' => 0,
            'latestFiles' => [],
            'latestFilesIndexes' => [],
            'dateCreated' => $modrinthMod['published'] ?? '',
            'dateModified' => $modrinthMod['updated'] ?? '',
            'dateReleased' => $modrinthMod['published'] ?? '',
            'allowModDistribution' => true,
            'gamePopularityRank' => 0,
        ];
    }

    /**
     * Get versions/files for a specific mod.
     *
     * @param array $params Filter parameters
     *
     * @throws ModsServiceException
     */
    public function getModFiles(string $modId, array $params = []): array
    {
        $resource = ($params['resource'] ?? 'mods') === 'plugins' ? 'plugins' : 'mods';
        $fileParams = [];

        // Add game version filter if provided
        if (!empty($params['gameVersion'])) {
            $fileParams['game_versions'] = json_encode([$params['gameVersion']]);
        }

        // Add loader filter if provided
        if ($resource === 'mods' && !empty($params['modLoaderType'])) {
            $loaderMap = [
                1 => 'forge',
                2 => 'cauldron',
                3 => 'liteloader',
                4 => 'fabric',
                5 => 'quilt',
                6 => 'neoforge',
            ];

            if (isset($loaderMap[$params['modLoaderType']])) {
                $fileParams['loaders'] = json_encode([$loaderMap[$params['modLoaderType']]]);
            }
        }

        if ($resource === 'plugins') {
            $pluginLoaders = $this->filterPluginLoaderPlatforms($params['platform'] ?? null);
            $fileParams['loaders'] = json_encode($pluginLoaders);
        }

        $cacheKey = "modrinth_mod_files_{$modId}_{$resource}_" . md5(json_encode($fileParams));

        $response = $this->makeCachedRequest($cacheKey, $this->cacheTtl['mod_files'], function () use ($modId, $fileParams) {
            return $this->makeRequest('GET', 'project/' . $modId . '/version', $fileParams);
        });

        // Transform to common format
        return $this->transformFilesResponse($response, $params);
    }

    /**
     * Transform Modrinth versions to the common files format.
     */
    private function transformFilesResponse(array $versions, array $params): array
    {
        $pageSize = min($params['pageSize'] ?? 20, config('modules.mods.max_page_size', 50));
        $index = $params['index'] ?? 0;

        // Paginate
        $paginatedVersions = array_slice($versions, $index, $pageSize);

        $transformedFiles = array_map(function ($version) {
            return $this->transformVersionToFile($version);
        }, $paginatedVersions);

        return [
            'data' => $transformedFiles,
            'pagination' => [
                'index' => $index,
                'pageSize' => $pageSize,
                'resultCount' => count($transformedFiles),
                'totalCount' => count($versions),
            ],
        ];
    }

    /**
     * Transform a Modrinth version to the common file format.
     */
    private function transformVersionToFile(array $version): array
    {
        $primaryFile = $version['files'][0] ?? [];

        return [
            'id' => $version['id'] ?? '',
            'gameId' => 432,
            'modId' => $version['project_id'] ?? '',
            'isAvailable' => true,
            'displayName' => $version['name'] ?? '',
            'fileName' => $primaryFile['filename'] ?? '',
            'releaseType' => $this->mapVersionType($version['version_type'] ?? 'release'),
            'fileStatus' => 4,
            'hashes' => [
                ['value' => $primaryFile['hashes']['sha1'] ?? '', 'algo' => 1],
                ['value' => $primaryFile['hashes']['sha512'] ?? '', 'algo' => 2],
            ],
            'fileDate' => $version['date_published'] ?? '',
            'fileLength' => $primaryFile['size'] ?? 0,
            'downloadCount' => $version['downloads'] ?? 0,
            'downloadUrl' => $primaryFile['url'] ?? '',
            'gameVersions' => $version['game_versions'] ?? [],
            'sortableGameVersions' => [],
            'dependencies' => array_map(function ($dep) {
                return [
                    'modId' => $dep['project_id'] ?? '',
                    'relationType' => $this->mapDependencyType($dep['dependency_type'] ?? 'optional'),
                ];
            }, $version['dependencies'] ?? []),
            'alternateFileId' => 0,
            'isServerPack' => false,
            'fileFingerprint' => 0,
            'modules' => [],
        ];
    }

    /**
     * Map Modrinth version type to a numeric release type (1=release, 2=beta, 3=alpha).
     */
    private function mapVersionType(string $versionType): int
    {
        return match ($versionType) {
            'release' => 1,
            'beta' => 2,
            'alpha' => 3,
            default => 1,
        };
    }

    /**
     * Map Modrinth dependency type to a numeric relation type (1=incompatible, 2=optional, 3=required).
     */
    private function mapDependencyType(string $dependencyType): int
    {
        return match ($dependencyType) {
            'required' => 3,
            'optional' => 2,
            'incompatible' => 1,
            default => 2,
        };
    }

    /**
     * Get download URL for a mod file.
     *
     * @throws ModsServiceException
     */
    public function getDownloadUrl(string $versionId): string
    {
        $version = $this->makeRequest('GET', 'version/' . $versionId);

        $primaryFile = $version['files'][0] ?? null;
        if (!$primaryFile || empty($primaryFile['url'])) {
            throw new ModsServiceException('No download URL found for this version.');
        }

        return $primaryFile['url'];
    }

    /**
     * Get Minecraft versions.
     *
     * @throws ModsServiceException
     */
    public function getMinecraftVersions(): array
    {
        $cacheKey = 'modrinth_minecraft_versions';

        $response = $this->makeCachedRequest($cacheKey, $this->cacheTtl['versions'], function () {
            return $this->makeRequest('GET', 'tag/game_version');
        });

        // Transform to common format
        return [
            'data' => array_map(function ($version) {
                return [
                    'id' => 0,
                    'gameVersionId' => 0,
                    'versionString' => $version['version'] ?? '',
                    'jarDownloadUrl' => '',
                    'jsonDownloadUrl' => '',
                    'approved' => true,
                    'dateModified' => '',
                    'gameVersionTypeId' => 1, // 1 = release type
                    'gameVersionStatus' => 1,
                    'gameVersionTypeStatus' => 1,
                ];
            }, $response),
        ];
    }

    /**
     * Get mod loader types.
     *
     * @throws ModsServiceException
     */
    public function getModLoaderTypes(): array
    {
        $cacheKey = 'modrinth_loader_types';

        $response = $this->makeCachedRequest($cacheKey, $this->cacheTtl['loaders'], function () {
            return $this->makeRequest('GET', 'tag/loader');
        });

        // Map loader names to their numeric IDs for the common format
        $loaderIdMap = [
            'forge' => 1,
            'cauldron' => 2,
            'liteloader' => 3,
            'fabric' => 4,
            'quilt' => 5,
            'neoforge' => 6,
        ];

        return [
            'data' => array_map(function ($loader) use ($loaderIdMap) {
                $loaderName = $loader['name'] ?? '';

                return [
                    'id' => $loaderIdMap[$loaderName] ?? 0,
                    'gameVersionTypeId' => 0,
                    'name' => ucfirst($loaderName),
                    'slug' => $loaderName,
                ];
            }, $response),
        ];
    }

    /**
     * Get rate limit usage for analytics.
     */
    public function getRateLimitUsage(): array
    {
        $requestsThisMinute = Cache::get('modrinth_requests_this_minute', 0);

        return [
            'requests_this_minute' => $requestsThisMinute,
            'requests_this_hour' => 0, // Modrinth only tracks per minute
            'limit_per_minute' => $this->rateLimitPerMinute,
            'limit_per_hour' => 0,
        ];
    }

}
