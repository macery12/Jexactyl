<?php

namespace Everest\Services\AI\Benchmark;

use Everest\Services\AI\Data\ProviderConfig;

/** Keeps the deliberately expensive benchmark on operator-owned inference. */
class BenchmarkProviderPolicy
{
    /** @return array{allowed: bool, reason: string} */
    public function check(ProviderConfig $config): array
    {
        if (!in_array($config->provider, [
            ProviderConfig::PROVIDER_OLLAMA,
            ProviderConfig::PROVIDER_OPENAI_COMPATIBLE,
        ], true)) {
            return [
                'allowed' => false,
                'reason' => 'Benchmarks are restricted to local Ollama or local OpenAI-compatible providers to prevent paid API token charges.',
            ];
        }

        $scheme = strtolower((string) parse_url($config->endpoint, PHP_URL_SCHEME));
        if (!in_array($scheme, ['http', 'https'], true)) {
            return [
                'allowed' => false,
                'reason' => 'The configured benchmark endpoint must use HTTP or HTTPS.',
            ];
        }

        $host = parse_url($config->endpoint, PHP_URL_HOST);
        if (!is_string($host) || !$this->isLocalHost($host)) {
            return [
                'allowed' => false,
                'reason' => 'The configured endpoint is not a local/private address. Use localhost, a private LAN/VPN address, or a local container hostname.',
            ];
        }

        return ['allowed' => true, 'reason' => 'Local model endpoint verified.'];
    }

    private function isLocalHost(string $host): bool
    {
        $host = strtolower(trim($host, '[]'));
        if ($host === '') {
            return false;
        }

        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return filter_var(
                $host,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
            ) === false;
        }

        if ($host === 'localhost' || str_ends_with($host, '.localhost')) {
            return true;
        }

        // Single-label hosts are customary on Docker and Kubernetes networks.
        if (!str_contains($host, '.')) {
            return preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $host) === 1;
        }

        foreach (['.local', '.internal', '.lan', '.home.arpa', '.svc', '.svc.cluster.local', '.test'] as $suffix) {
            if (str_ends_with($host, $suffix)) {
                return true;
            }
        }

        return false;
    }
}
