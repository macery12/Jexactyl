<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Everest\Http\Controllers\Api\Client\ClientApiController;

class AddressAutocompleteController extends ClientApiController
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Proxy an address search to Nominatim (OpenStreetMap).
     *
     * Requests are cached for 60 minutes by query hash to minimize outbound
     * calls. User IPs are never forwarded to the Nominatim server.
     */
    public function search(Request $request): JsonResponse
    {
        $request->validate([
            'q' => ['required', 'string', 'min:3', 'max:200'],
        ]);

        $query = trim($request->input('q'));
        $cacheKey = 'nominatim:' . md5($query);

        $results = Cache::remember($cacheKey, 3600, function () use ($query) {
            return $this->fetchFromNominatim($query);
        });

        return response()->json($results);
    }

    private function fetchFromNominatim(string $query): array
    {
        $baseUrl = rtrim(config('services.nominatim.base_url', 'https://nominatim.openstreetmap.org'), '/');
        $appUrl = config('app.url', 'https://panel.example.com');
        $appName = config('app.name', 'Everest Panel');

        try {
            $response = Http::timeout(5)
                ->withHeaders([
                    // Nominatim requires a descriptive User-Agent per their ToS
                    'User-Agent' => "{$appName} ({$appUrl})",
                    'Accept-Language' => 'en',
                ])
                ->get("{$baseUrl}/search", [
                    'q'              => $query,
                    'format'         => 'jsonv2',
                    'addressdetails' => 1,
                    'limit'          => 5,
                    'layer'          => 'address',
                ]);

            if (!$response->successful()) {
                Log::warning('Nominatim search returned non-200', [
                    'status' => $response->status(),
                    'query'  => $query,
                ]);

                return [];
            }

            return array_map(
                fn (array $place) => $this->normalizeSuggestion($place),
                $response->json() ?? []
            );
        } catch (\Throwable $e) {
            Log::warning('Nominatim address lookup failed', ['error' => $e->getMessage()]);

            return [];
        }
    }

    private function normalizeSuggestion(array $place): array
    {
        $addr = $place['address'] ?? [];

        // Build the street line from house_number + road when available
        $road = $addr['road'] ?? $addr['pedestrian'] ?? $addr['footway'] ?? '';
        $houseNumber = $addr['house_number'] ?? '';
        $line1 = $houseNumber ? trim("{$houseNumber} {$road}") : $road;

        // City: prefer city, then town, then village, then suburb
        $city = $addr['city'] ?? $addr['town'] ?? $addr['village'] ?? $addr['suburb'] ?? '';

        // State / region
        $state = $addr['state'] ?? $addr['region'] ?? $addr['county'] ?? '';

        return [
            'label'        => $place['display_name'] ?? '',
            'line1'        => $line1,
            'city'         => $city,
            'state'        => $state,
            'postal_code'  => $addr['postcode'] ?? '',
            'country_code' => strtoupper($addr['country_code'] ?? ''),
        ];
    }
}
