<?php

namespace Everest\Services\Servers;

use Everest\Models\Server;
use Illuminate\Support\Facades\Http;
use Illuminate\Contracts\Cache\Repository as CacheRepository;

class StartupVariableVersionService
{
    private const VARIABLE_PROVIDER_MAP = [
        'VANILLA_VERSION' => ['provider' => 'mojang_manifest', 'supports_snapshots' => true, 'include_special_latest' => true],
        'MINECRAFT_VERSION' => ['provider' => 'mojang_manifest', 'supports_snapshots' => true],
        'MC_VERSION' => ['provider' => 'mojang_manifest', 'supports_snapshots' => true],
        'BUNGEE_VERSION' => ['provider' => 'bungeecord_builds', 'supports_snapshots' => false, 'include_special_latest' => true],
        'BUILD_NUMBER' => ['provider' => 'paper_builds', 'supports_snapshots' => false, 'include_special_latest' => true, 'depends_on' => ['MINECRAFT_VERSION', 'MC_VERSION']],
        'FORGE_VERSION' => ['provider' => 'forge_promotions', 'supports_snapshots' => false],
        'SPONGE_VERSION' => ['provider' => 'sponge_versions', 'supports_snapshots' => false],
    ];

    public function __construct(private CacheRepository $cache)
    {
    }

    public function getOptionsForVariable(Server $server, string $envVariable, bool $includeSnapshots = false, array $context = []): array
    {
        $envVariable = strtoupper($envVariable);
        $providerConfig = self::VARIABLE_PROVIDER_MAP[$envVariable] ?? null;

        if (is_null($providerConfig)) {
            return [
                'supported' => false,
                'provider' => null,
                'supports_snapshots' => false,
                'include_snapshots' => false,
                'options' => [],
                'context' => [],
            ];
        }

        $supportsSnapshots = (bool) ($providerConfig['supports_snapshots'] ?? false);
        $includeSnapshots = $supportsSnapshots && $includeSnapshots;
        $resolvedContext = $this->resolveContext($server, $providerConfig, $context);

        $payload = $this->getCachedOptions(
            provider: $providerConfig['provider'],
            envVariable: $envVariable,
            includeSnapshots: $includeSnapshots,
            context: $resolvedContext,
            includeSpecialLatest: (bool) ($providerConfig['include_special_latest'] ?? false),
        );

        return [
            'supported' => true,
            'provider' => $providerConfig['provider'],
            'supports_snapshots' => $supportsSnapshots,
            'include_snapshots' => $includeSnapshots,
            'options' => $payload['options'] ?? [],
            'stale' => (bool) ($payload['stale'] ?? false),
            'error' => $payload['error'] ?? null,
            'context' => $resolvedContext,
        ];
    }

    private function getCachedOptions(string $provider, string $envVariable, bool $includeSnapshots, array $context, bool $includeSpecialLatest): array
    {
        $cacheFingerprint = md5(json_encode([
            'provider' => $provider,
            'env' => $envVariable,
            'snapshots' => $includeSnapshots,
            'context' => $context,
            'special_latest' => $includeSpecialLatest,
        ], JSON_THROW_ON_ERROR));

        $cacheKey = sprintf('startup:variable-versions:%s:%s', $provider, $cacheFingerprint);
        $staleCacheKey = $cacheKey . ':stale';

        $cached = $this->cache->get($cacheKey);
        if (is_array($cached)) {
            return $cached + ['stale' => false];
        }

        try {
            $options = $this->fetchOptions($provider, $includeSnapshots, $context, $includeSpecialLatest);

            $payload = [
                'options' => $options,
                'stale' => false,
                'error' => null,
            ];

            $this->cache->put($cacheKey, $payload, now()->addSeconds((int) config('minecraft_versions.cache_ttl', 900)));
            $this->cache->put($staleCacheKey, $payload, now()->addSeconds((int) config('minecraft_versions.stale_cache_ttl', 86400)));

            return $payload;
        } catch (\Exception $exception) {
            $stalePayload = $this->cache->get($staleCacheKey);
            if (is_array($stalePayload)) {
                return $stalePayload + ['stale' => true, 'error' => null];
            }

            return [
                'options' => [],
                'stale' => false,
                'error' => 'Version provider is temporarily unavailable.',
            ];
        }
    }

    private function fetchOptions(string $provider, bool $includeSnapshots, array $context, bool $includeSpecialLatest): array
    {
        return match ($provider) {
            'mojang_manifest' => $this->fetchMojangManifestVersions($includeSnapshots, $includeSpecialLatest),
            'bungeecord_builds' => $this->fetchBungeeBuilds($includeSpecialLatest),
            'paper_builds' => $this->fetchPaperBuilds($context, $includeSpecialLatest),
            'forge_promotions' => $this->fetchForgePromotions(),
            'sponge_versions' => $this->fetchSpongeVersions(),
            default => [],
        };
    }

    private function fetchMojangManifestVersions(bool $includeSnapshots, bool $includeSpecialLatest): array
    {
        $response = Http::timeout((int) config('minecraft_versions.request_timeout', 8))
            ->get((string) config('minecraft_versions.providers.mojang_manifest_url', 'https://launchermeta.mojang.com/mc/game/version_manifest.json'))
            ->throw();

        $data = $response->json();
        $versions = $data['versions'] ?? [];

        $options = [];
        foreach ($versions as $item) {
            $type = $item['type'] ?? 'release';
            $id = $item['id'] ?? null;

            if (!is_string($id) || $id === '') {
                continue;
            }

            if ($type !== 'release' && !($includeSnapshots && $type === 'snapshot')) {
                continue;
            }

            $options[] = [
                'value' => $id,
                'label' => $id,
                'stable' => $type === 'release',
            ];
        }

        if ($includeSpecialLatest) {
            array_unshift($options, ['value' => 'latest', 'label' => 'latest', 'stable' => true]);
            if ($includeSnapshots) {
                array_unshift($options, ['value' => 'snapshot', 'label' => 'snapshot', 'stable' => false]);
            }
        }

        return $this->uniqueAndLimitOptions($options);
    }

    private function fetchBungeeBuilds(bool $includeSpecialLatest): array
    {
        $response = Http::timeout((int) config('minecraft_versions.request_timeout', 8))
            ->get((string) config('minecraft_versions.providers.bungee_builds_url', 'https://ci.md-5.net/job/BungeeCord/api/json?tree=builds[number]'))
            ->throw();

        $builds = $response->json('builds', []);
        $options = [];

        if ($includeSpecialLatest) {
            $options[] = ['value' => 'latest', 'label' => 'latest', 'stable' => true];
        }

        foreach ($builds as $build) {
            $number = $build['number'] ?? null;
            if (is_null($number)) {
                continue;
            }

            $value = (string) $number;
            if (!is_numeric($value)) {
                continue;
            }

            $options[] = [
                'value' => $value,
                'label' => $value,
                'stable' => true,
            ];
        }

        return $this->uniqueAndLimitOptions($options);
    }

    private function fetchPaperBuilds(array $context, bool $includeSpecialLatest): array
    {
        $mcVersion = trim((string) ($context['MINECRAFT_VERSION'] ?? $context['MC_VERSION'] ?? ''));

        if ($mcVersion === '' || $mcVersion === 'latest' || $mcVersion === 'snapshot') {
            $latest = $this->resolveLatestMojangRelease();
            $mcVersion = $latest === '' ? $mcVersion : $latest;
        }

        if ($mcVersion === '') {
            return [];
        }

        $urlTemplate = (string) config('minecraft_versions.providers.paper_builds_url', 'https://api.papermc.io/v2/projects/paper/versions/{version}');
        $url = str_replace('{version}', urlencode($mcVersion), $urlTemplate);

        $response = Http::timeout((int) config('minecraft_versions.request_timeout', 8))
            ->get($url)
            ->throw();

        $builds = $response->json('builds', []);
        $builds = is_array($builds) ? $builds : [];
        rsort($builds);

        $options = [];
        if ($includeSpecialLatest) {
            $options[] = ['value' => 'latest', 'label' => 'latest', 'stable' => true];
        }

        foreach ($builds as $build) {
            $value = (string) $build;
            if (!is_numeric($value)) {
                continue;
            }

            $options[] = [
                'value' => $value,
                'label' => $value,
                'stable' => true,
            ];
        }

        return $this->uniqueAndLimitOptions($options);
    }

    private function fetchForgePromotions(): array
    {
        $response = Http::timeout((int) config('minecraft_versions.request_timeout', 8))
            ->get((string) config('minecraft_versions.providers.forge_promotions_url', 'https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json'))
            ->throw();

        $promos = $response->json('promos', []);
        if (!is_array($promos)) {
            return [];
        }

        $options = [];
        foreach ($promos as $key => $buildVersion) {
            if (!is_string($key) || !is_string($buildVersion)) {
                continue;
            }

            if (!str_contains($key, '-latest') && !str_contains($key, '-recommended')) {
                continue;
            }

            $minecraftVersion = explode('-', $key)[0] ?? null;
            if (!is_string($minecraftVersion) || $minecraftVersion === '') {
                continue;
            }

            $fullVersion = sprintf('%s-%s', $minecraftVersion, $buildVersion);
            $options[] = [
                'value' => $fullVersion,
                'label' => $fullVersion,
                'stable' => true,
            ];
        }

        usort($options, function (array $a, array $b): int {
            return version_compare($b['value'], $a['value']);
        });

        return $this->uniqueAndLimitOptions($options);
    }

    private function fetchSpongeVersions(): array
    {
        $response = Http::timeout((int) config('minecraft_versions.request_timeout', 8))
            ->get((string) config('minecraft_versions.providers.sponge_metadata_url', 'https://repo.spongepowered.org/maven/org/spongepowered/spongevanilla/maven-metadata.xml'))
            ->throw();

        $xml = (string) $response->body();
        preg_match_all('/<version>([^<]+)<\/version>/', $xml, $matches);

        $versions = $matches[1] ?? [];
        $versions = array_filter($versions, fn ($value) => is_string($value) && $value !== '');

        usort($versions, function (string $a, string $b): int {
            return version_compare($b, $a);
        });

        $options = array_map(function (string $value): array {
            return [
                'value' => $value,
                'label' => $value,
                'stable' => true,
            ];
        }, $versions);

        return $this->uniqueAndLimitOptions($options);
    }

    private function resolveLatestMojangRelease(): string
    {
        $response = Http::timeout((int) config('minecraft_versions.request_timeout', 8))
            ->get((string) config('minecraft_versions.providers.mojang_manifest_url', 'https://launchermeta.mojang.com/mc/game/version_manifest.json'))
            ->throw();

        return (string) $response->json('latest.release', '');
    }

    private function resolveContext(Server $server, array $providerConfig, array $context): array
    {
        $server->loadMissing('variables');

        $values = [];
        foreach ($server->variables as $variable) {
            $values[$variable->env_variable] = (string) ($variable->server_value ?? $variable->default_value ?? '');
        }

        $resolved = [];
        foreach (($providerConfig['depends_on'] ?? []) as $dependency) {
            $dependency = strtoupper((string) $dependency);
            $contextValue = $context[$dependency] ?? null;

            if (is_string($contextValue) && $contextValue !== '') {
                $resolved[$dependency] = $contextValue;
                continue;
            }

            $resolved[$dependency] = $values[$dependency] ?? '';
        }

        return $resolved;
    }

    private function uniqueAndLimitOptions(array $options): array
    {
        $seen = [];
        $unique = [];

        foreach ($options as $option) {
            $value = $option['value'] ?? null;
            if (!is_string($value) || isset($seen[$value])) {
                continue;
            }

            $seen[$value] = true;
            $unique[] = [
                'value' => $value,
                'label' => (string) ($option['label'] ?? $value),
                'stable' => (bool) ($option['stable'] ?? true),
            ];
        }

        return array_slice($unique, 0, (int) config('minecraft_versions.max_options', 300));
    }
}
