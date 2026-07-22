<?php

namespace Everest\Services\Mods;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Everest\Exceptions\Service\Mods\ModsServiceException;

class SpigetService
{
    private string $endpoint;
    private int $defaultPageSize;
    private const REDACTED_VALUE = '[redacted]';
    private array $cacheTtl = [
        'search' => 300,   // 5 minutes
        'project' => 1800, // 30 minutes
        'versions' => 600, // 10 minutes
        'categories' => 3600, // 60 minutes
    ];
    private const GAME_ID_MINECRAFT = 432;

    public function __construct()
    {
        $this->endpoint = rtrim(config('modules.mods.spiget_api_url', 'https://api.spiget.org/v2'), '/');
        $this->defaultPageSize = (int) config('modules.mods.default_page_size', 20);
    }

    /**
     * Search plugins on Spiget.
     *
     * @throws ModsServiceException
     */
    public function searchMods(array $params = []): array
    {
        $query = $params['searchFilter'] ?? '';
        $categoryId = $params['categoryId'] ?? null;
        $sort = $this->mapSortField($params['sortField'] ?? null);
        $minRating = $params['minRating'] ?? null;
        $pageSize = (int) ($params['pageSize'] ?? $this->defaultPageSize);
        $index = (int) ($params['index'] ?? 0);
        $page = $pageSize > 0 ? (int) floor($index / $pageSize) : 0;

        $cacheKey = sprintf(
            'spiget_search_%s_%s_%s_%s_%s_%s',
            md5($query),
            $page,
            $pageSize,
            $sort,
            (string) $categoryId,
            (string) $minRating
        );

        return $this->makeCachedRequest($cacheKey, $this->cacheTtl['search'], function () use ($query, $categoryId, $page, $pageSize, $sort, $minRating) {
            $path = $this->resolveListPath($query, $categoryId);
            $response = $this->request($path, [
                'page' => $page,
                'size' => $pageSize,
                'sort' => $sort,
                'fields' => 'id,name,tag,downloads,rating,releaseDate,updateDate,testedVersions,version,author,icon,category,premium,external,file,sourceCodeLink,donationLink',
            ]);

            $data = array_values(array_filter(array_map(function ($item) {
                return $this->transformResourceToCommonFormat($item, []);
            }, $response), fn ($item) => !($item['isPremium'] ?? false)));

            if (!is_null($minRating)) {
                $data = array_values(array_filter($data, function ($item) use ($minRating) {
                    $rating = $item['rating']['average'] ?? null;

                    return $rating === null ? false : $rating >= (float) $minRating;
                }));
            }

            $resultCount = count($data);
            $totalCount = ($page * $pageSize) + $resultCount;

            $payload = [
                'data' => $data,
                'pagination' => [
                    'index' => $page * $pageSize,
                    'pageSize' => $pageSize,
                    'resultCount' => $resultCount,
                    'totalCount' => $totalCount,
                ],
            ];
            $payload['filters'] = $this->getFiltersMetadata();

            return $payload;
        });
    }

    /**
     * Get a plugin by ID.
     *
     * @throws ModsServiceException
     */
    public function getMod(string|int $modId): array
    {
        $cacheKey = "spiget_mod_{$modId}";

        return $this->makeCachedRequest($cacheKey, $this->cacheTtl['project'], function () use ($modId) {
            $resource = $this->request("/resources/{$modId}", [
                'fields' => 'id,name,tag,downloads,rating,releaseDate,updateDate,testedVersions,version,author,icon,category,premium,external,file,description,documentation,sourceCodeLink,donationLink',
            ]);

            $authors = $this->hydrateAuthors([$resource]);

            $latestVersion = $this->safeRequest("/resources/{$modId}/versions/latest");

            return $this->transformResourceToCommonFormat($resource, $authors, $latestVersion);
        });
    }

    /**
     * Get versions for a plugin.
     *
     * @throws ModsServiceException
     */
    public function getModFiles(string|int $modId, array $params = []): array
    {
        $pageSize = (int) ($params['pageSize'] ?? 20);
        $index = (int) ($params['index'] ?? 0);
        $page = $pageSize > 0 ? (int) floor($index / $pageSize) : 0;

        $cacheKey = sprintf('spiget_versions_%s_%s_%s', $modId, $page, $pageSize);

        return $this->makeCachedRequest($cacheKey, $this->cacheTtl['versions'], function () use ($modId, $page, $pageSize) {
            $versions = $this->request("/resources/{$modId}/versions", [
                'page' => $page,
                'size' => $pageSize,
                'sort' => '-releaseDate',
            ]);

            $files = array_map(function ($version) use ($modId) {
                return $this->transformVersionToFile($modId, $version);
            }, $versions);

            $resultCount = count($files);
            $totalCount = ($page * $pageSize) + $resultCount;

            return [
                'data' => $files,
                'pagination' => [
                    'index' => $page * $pageSize,
                    'pageSize' => $pageSize,
                    'resultCount' => $resultCount,
                    'totalCount' => $totalCount,
                ],
            ];
        });
    }

    /**
     * Get download details for a version.
     *
     * @return array{url: string, fileName: string|null, fileSize: int|null}
     *
     * @throws ModsServiceException
     */
    public function getDownloadUrl(string|int $modId, string|int $versionId): array
    {
        return [
            // Always use the base resource download endpoint; Spiget handles redirecting to the latest file.
            'url' => $this->endpoint . "/resources/{$modId}/download",
            'fileName' => null,
            'fileSize' => null,
        ];
    }

    /**
     * Spiget does not expose Minecraft version metadata in a consistent way; return tested versions when available.
     */
    public function getMinecraftVersions(): array
    {
        return ['data' => []];
    }

    /**
     * Spiget does not expose mod loader metadata; return empty array for compatibility.
     */
    public function getModLoaderTypes(): array
    {
        return ['data' => []];
    }

    /**
     * Basic rate limit placeholder for analytics compatibility.
     */
    public function getRateLimitUsage(): array
    {
        return [
            'requests_this_minute' => 0,
            'requests_this_hour' => 0,
            'limit_per_minute' => 120,
            'limit_per_hour' => 3000,
        ];
    }

    /**
     * Filters metadata describing supported/unsupported options.
     */
    public function getFiltersMetadata(): array
    {
        return [
            'supported' => [
                'search' => true,
                'category' => true,
                'sort' => array_keys($this->sortFieldMap()),
                'minRating' => true,
            ],
            'unsupported' => [
                'minecraftVersion' => 'Spiget does not provide reliable per-version filtering.',
                'modLoader' => 'Not applicable for Spigot plugins.',
            ],
            'options' => [
                'categories' => $this->getCategories(),
                'sortBy' => $this->getSortOptions(),
                'minRating' => $this->getMinRatingOptions(),
            ],
        ];
    }

    /**
     * Transform a Spiget resource into the common mod representation used by the UI.
     */
    private function transformResourceToCommonFormat(array $resource, array $authors, array $latestVersion = []): array
    {
        $authorId = $resource['author']['id'] ?? null;
        $authorName = $resource['author']['name'] ?? ($authorId && isset($authors[$authorId]) ? $authors[$authorId] : 'Unknown');
        $testedVersions = $resource['testedVersions'] ?? [];
        $latestVersionName = $resource['version']['id'] ?? null;
        $isPremium = (bool) ($resource['premium'] ?? false);
        $isExternal = (bool) ($resource['external'] ?? false);
        $file = $resource['file'] ?? [];
        $latest = $latestVersion ?: [];

        return [
            'id' => $resource['id'],
            'gameId' => self::GAME_ID_MINECRAFT,
            'name' => $resource['name'] ?? 'Unknown Plugin',
            'slug' => (string) ($resource['id'] ?? ''),
            'links' => [
                'websiteUrl' => "https://www.spigotmc.org/resources/{$resource['id']}",
                'wikiUrl' => '',
                'issuesUrl' => '',
                'sourceUrl' => $resource['sourceCodeLink'] ?? '',
            ],
            'summary' => $resource['tag'] ?? 'No description provided.',
            'status' => 4,
            'downloadCount' => $resource['downloads'] ?? 0,
            'isFeatured' => false,
            'primaryCategoryId' => $resource['category']['id'] ?? 0,
            'categories' => isset($resource['category'])
                ? [
                    [
                        'id' => $resource['category']['id'] ?? 0,
                        'name' => $resource['category']['name'] ?? '',
                    ],
                ]
                : [],
            'classId' => 0,
            'authors' => [
                [
                    'id' => $authorId ?? 0,
                    'name' => $authorName,
                    'url' => $authorId ? "https://api.spiget.org/v2/authors/{$authorId}" : '',
                ],
            ],
            'logo' => [
                'id' => $resource['icon']['id'] ?? 0,
                'modId' => $resource['id'] ?? 0,
                'title' => $resource['name'] ?? '',
                'description' => '',
                'thumbnailUrl' => $this->endpoint . '/resources/' . $resource['id'] . '/icon',
                'url' => $this->endpoint . '/resources/' . $resource['id'] . '/icon',
            ],
            'screenshots' => [],
            'mainFileId' => $latestVersionName ?? 0,
            'latestFiles' => $latestVersionName ? [
                [
                    'id' => $latestVersionName,
                    'fileName' => $latestVersionName . '.jar',
                    'displayName' => $latestVersionName,
                    'gameVersions' => $testedVersions,
                    'fileDate' => isset($resource['updateDate']) ? date('c', (int) $resource['updateDate']) : '',
                    'fileLength' => 0,
                    'releaseType' => 1,
                    'downloadUrl' => null,
                    'downloadCount' => $resource['downloads'] ?? 0,
                    'modules' => [],
                    'dependencies' => [],
                    'isAvailable' => true,
                    'fileStatus' => 4,
                    'sortableGameVersions' => [],
                    'alternateFileId' => 0,
                    'isServerPack' => false,
                    'fileFingerprint' => 0,
                ],
            ] : [],
            'latestFilesIndexes' => [],
            'dateCreated' => isset($resource['releaseDate']) ? date('c', (int) $resource['releaseDate']) : '',
            'dateModified' => isset($resource['updateDate']) ? date('c', (int) $resource['updateDate']) : '',
            'dateReleased' => isset($resource['releaseDate']) ? date('c', (int) $resource['releaseDate']) : '',
            'allowModDistribution' => true,
            'gamePopularityRank' => 0,
            'rating' => $resource['rating'] ?? ['average' => 0, 'count' => 0],
            'isPremium' => $isPremium,
            'isExternal' => $isExternal,
            'externalUrl' => $file['externalUrl'] ?? null,
            'testedVersions' => $testedVersions,
            'description' => $resource['description'] ?? null,
            'documentation' => $resource['documentation'] ?? null,
            'file' => [
                'type' => $file['type'] ?? null,
                'size' => $file['size'] ?? null,
                'sizeUnit' => $file['sizeUnit'] ?? null,
                'url' => $file['url'] ?? null,
                'externalUrl' => $file['externalUrl'] ?? null,
            ],
            'latestVersion' => [
                'id' => $latest['id'] ?? null,
                'name' => $latest['name'] ?? null,
                'releaseDate' => isset($latest['releaseDate']) ? date('c', (int) $latest['releaseDate']) : null,
                'downloads' => $latest['downloads'] ?? null,
                'rating' => $latest['rating'] ?? null,
            ],
        ];
    }

    private function transformVersionToFile(string|int $modId, array $version): array
    {
        $fileName = ($version['name'] ?? 'plugin') . '.jar';

        return [
            'id' => $version['id'],
            'gameId' => self::GAME_ID_MINECRAFT,
            'modId' => (int) $modId,
            'isAvailable' => true,
            'displayName' => $version['name'] ?? 'Unknown',
            'fileName' => $fileName,
            'releaseType' => 1,
            'fileStatus' => 4,
            'hashes' => [],
            'fileDate' => isset($version['releaseDate']) ? date('c', (int) $version['releaseDate']) : '',
            'fileLength' => $version['size'] ?? null,
            'downloadCount' => $version['downloads'] ?? 0,
            'downloadUrl' => $this->getDownloadUrl($modId, $version['id'])['url'],
            'gameVersions' => [],
            'sortableGameVersions' => [],
            'dependencies' => [],
            'alternateFileId' => 0,
            'isServerPack' => false,
            'fileFingerprint' => 0,
            'modules' => [],
        ];
    }

    /**
     * Fetch and cache author names for a list of resources.
     *
     * @throws ModsServiceException
     */
    private function hydrateAuthors(array $resources): array
    {
        $authorIds = array_unique(array_filter(array_map(function ($resource) {
            return $resource['author']['id'] ?? null;
        }, $resources)));

        $authors = [];
        foreach ($authorIds as $authorId) {
            $cacheKey = "spiget_author_{$authorId}";
            $authors[$authorId] = Cache::remember($cacheKey, 3600, function () use ($authorId) {
                $author = $this->request("/authors/{$authorId}", [
                    'fields' => 'id,name',
                ]);

                return $author['name'] ?? 'Unknown';
            });
        }

        return $authors;
    }

    /**
     * Make a cached request wrapper.
     *
     * @throws ModsServiceException
     */
    private function makeCachedRequest(string $cacheKey, int $ttl, callable $callback)
    {
        return Cache::remember($cacheKey, $ttl, $callback);
    }

    /**
     * Resolve list path based on search and category.
     */
    private function resolveListPath(string $query, string|int|null $categoryId): string
    {
        if ($categoryId) {
            return "/categories/{$categoryId}/resources";
        }

        if ($query) {
            return '/search/resources/' . urlencode($query);
        }

        return '/resources/free';
    }

    /**
     * Map UI sort field to Spiget sort parameter.
     */
    private function mapSortField(?string $sortField): string
    {
        $map = $this->sortFieldMap();

        return $map[$sortField] ?? '-downloads';
    }

    private function sortFieldMap(): array
    {
        return [
            'downloads' => '-downloads',
            'rating' => '-rating.average',
            'updated' => '-updateDate',
            'newest' => '-releaseDate',
            'name' => 'name',
        ];
    }

    private function getSortOptions(): array
    {
        return [
            ['id' => 'downloads', 'label' => 'Downloads'],
            ['id' => 'rating', 'label' => 'Rating'],
            ['id' => 'updated', 'label' => 'Recently Updated'],
            ['id' => 'newest', 'label' => 'Newest'],
            ['id' => 'name', 'label' => 'Name (A–Z)'],
        ];
    }

    private function getMinRatingOptions(): array
    {
        return [
            ['id' => null, 'label' => 'Any Rating'],
            ['id' => 4.5, 'label' => '4.5+'],
            ['id' => 4.0, 'label' => '4.0+'],
            ['id' => 3.5, 'label' => '3.5+'],
            ['id' => 3.0, 'label' => '3.0+'],
        ];
    }

    /**
     * Fetch categories with caching.
     */
    private function getCategories(): array
    {
        return $this->makeCachedRequest('spiget_categories', $this->cacheTtl['categories'], function () {
            $categories = $this->request('/categories', [
                'page' => 0,
                'size' => 200,
                'sort' => 'name',
            ]);

            $unique = [];
            foreach ($categories as $category) {
                $name = $category['name'] ?? '';
                $key = mb_strtolower(trim($name));
                if ($key === '') {
                    continue;
                }
                if (array_key_exists($key, $unique)) {
                    continue;
                }
                $unique[$key] = [
                    'id' => $category['id'] ?? 0,
                    'name' => $name,
                ];
            }

            return array_values($unique);
        });
    }

    /**
     * Perform an HTTP request to the Spiget API.
     *
     * @throws ModsServiceException
     */
    private function request(string $path, array $params = []): array
    {
        $url = $this->endpoint . $path;

        $response = Http::retry(2, 200, throw: false)
            ->timeout(10)
            ->connectTimeout(5)
            ->get($url, $params);

        if (!$response->successful()) {
            $status = $response->status();
            throw new ModsServiceException('Failed to communicate with Spiget API. HTTP status: ' . $status);
        }

        $decoded = $response->json();
        if (!is_array($decoded)) {
            throw new ModsServiceException('Invalid response from Spiget API.');
        }

        return $decoded;
    }

    private function safeRequest(string $path, array $params = []): array
    {
        try {
            return $this->request($path, $params);
        } catch (ModsServiceException $exception) {
            Log::warning('Spiget request failed', [
                'provider' => 'spiget',
                'path' => $path,
                'params' => $this->sanitizeParams($params),
                'error' => $exception->getMessage(),
            ]);

            throw new ModsServiceException(sprintf('Unable to load data from the Spigot provider for "%s". Please try again later.', $path), previous: $exception);
        }
    }

    private function sanitizeParams(array $params): array
    {
        return array_map(function ($value) {
            if (is_scalar($value) || $value === null) {
                return $value;
            }

            return self::REDACTED_VALUE;
        }, $params);
    }
}
