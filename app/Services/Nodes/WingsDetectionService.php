<?php

namespace Everest\Services\Nodes;

use Everest\Models\Node;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use Everest\Repositories\Wings\DaemonConfigurationRepository;

class WingsDetectionService
{
    public function __construct(
        private DaemonConfigurationRepository $configurationRepository,
    ) {
    }

    /**
     * Detect whether a node is running Wings-RS and update its type accordingly.
     * Returns true if the node is Wings-RS, false otherwise.
     */
    public function detect(Node $node): bool
    {
        try {
            $repository = $this->configurationRepository->setNode($node);

            $overviewData = $this->fetchWingsRsOverview($repository);
            $systemData = $repository->getSystemInformation();

            $isSupercharged = !is_null($overviewData)
                || !empty($systemData['supercharged'])
                || $this->isWingsRsVersion($systemData['version'] ?? '');

            $wingsVersion = $overviewData['version']
                ?? $systemData['version']
                ?? null;

            $node->update([
                'wings_type' => $isSupercharged ? Node::WINGS_TYPE_RS : Node::WINGS_TYPE_DEFAULT,
                'wings_version' => $wingsVersion,
                'wings_detected_at' => CarbonImmutable::now(),
            ]);

            return $isSupercharged;
        } catch (\Exception $e) {
            Log::warning('Failed to detect Wings type for node ' . $node->name, [
                'node_id' => $node->id,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * Attempt to fetch Wings-RS system overview.
     * Returns null when endpoint is not available (normal Wings) or on error.
     */
    private function fetchWingsRsOverview(DaemonConfigurationRepository $repository): ?array
    {
        try {
            $response = $repository->getHttpClient()->get('/api/system/overview');
            $data = json_decode($response->getBody()->__toString(), true);

            if (!is_array($data)) {
                return null;
            }

            return $data;
        } catch (\Exception) {
            return null;
        }
    }

    /**
     * Check if the version string indicates Wings-RS.
     */
    private function isWingsRsVersion(string $version): bool
    {
        // Wings-RS uses Rust-style version strings or contains 'rs' identifier
        return str_contains(strtolower($version), 'rs')
            || str_contains(strtolower($version), 'rust')
            || str_contains(strtolower($version), 'supercharged');
    }

    /**
     * Detect Wings-RS for a node and return system overview data if available.
     * This calls /api/system/overview which is Wings-RS exclusive.
     */
    public function getOverview(Node $node): ?array
    {
        if (!$node->isSupercharged()) {
            return null;
        }

        try {
            $response = $this->configurationRepository->setNode($node)
                ->getHttpClient()
                ->get('/api/system/overview');

            return json_decode($response->getBody()->__toString(), true);
        } catch (\Exception $e) {
            Log::debug('Failed to get Wings-RS overview for node ' . $node->name, [
                'node_id' => $node->id,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }
}
