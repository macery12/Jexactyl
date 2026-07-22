<?php

namespace Everest\Http\Controllers\Api\Application\Billing;

use Everest\Models\Egg;
use Everest\Models\Nest;
use Illuminate\Http\Response;
use Everest\Models\CustomDomain;
use Illuminate\Http\JsonResponse;
use Everest\Models\CustomDomainApiKey;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\CustomDomains\GetCustomDomainApiKeysRequest;
use Everest\Http\Requests\Api\Application\CustomDomains\StoreCustomDomainApiKeyRequest;
use Everest\Http\Requests\Api\Application\Billing\CustomDomains\GetCustomDomainsRequest;
use Everest\Http\Requests\Api\Application\CustomDomains\DeleteCustomDomainApiKeyRequest;
use Everest\Http\Requests\Api\Application\CustomDomains\UpdateCustomDomainApiKeyRequest;
use Everest\Http\Requests\Api\Application\Billing\CustomDomains\StoreCustomDomainRequest;
use Everest\Http\Requests\Api\Application\Billing\CustomDomains\DeleteCustomDomainRequest;
use Everest\Http\Requests\Api\Application\Billing\CustomDomains\UpdateCustomDomainRequest;

class CustomDomainController extends ApplicationApiController
{
    public function index(GetCustomDomainsRequest $request): JsonResponse
    {
        $domains = CustomDomain::query()->with('apiKey')->orderBy('domain')->get();

        return response()->json([
            'data' => $domains->map(function (CustomDomain $domain) {
                return [
                    'id' => $domain->id,
                    'domain' => $domain->domain,
                    'cloudflare_zone_id' => $domain->cloudflare_zone_id,
                    'api_key_id' => $domain->api_key_id,
                    'api_key_name' => $domain->apiKey?->name,
                    'allowed_nest_ids' => $domain->allowed_nest_ids ?? [],
                    'allowed_egg_ids' => $domain->allowed_egg_ids ?? [],
                    'service_tag' => $domain->service_tag,
                    'egg_service_tags' => $domain->egg_service_tags ?? (object) [],
                    'wildcard_enabled' => $domain->wildcard_enabled,
                    'enabled' => $domain->enabled,
                    'created_at' => $domain->created_at,
                    'updated_at' => $domain->updated_at,
                ];
            })->values(),
        ]);
    }

    public function store(StoreCustomDomainRequest $request): JsonResponse
    {
        $domain = CustomDomain::query()->create([
            'domain' => strtolower($request->input('domain')),
            'cloudflare_zone_id' => $request->input('cloudflare_zone_id'),
            'api_key_id' => $request->integer('api_key_id') ?: null,
            'allowed_nest_ids' => array_values(array_unique(array_map('intval', (array) $request->input('allowed_nest_ids', [])))),
            'allowed_egg_ids' => array_values(array_unique(array_map('intval', (array) $request->input('allowed_egg_ids', [])))),
            'service_tag' => $request->filled('service_tag') ? strtolower((string) $request->input('service_tag')) : null,
            'egg_service_tags' => $this->sanitizeEggServiceTags((array) $request->input('egg_service_tags', [])),
            'wildcard_enabled' => $request->boolean('wildcard_enabled', false),
            'enabled' => $request->boolean('enabled', true),
        ]);

        return response()->json(['data' => $domain], Response::HTTP_CREATED);
    }

    public function update(UpdateCustomDomainRequest $request, CustomDomain $customDomain): JsonResponse
    {
        $customDomain->update([
            'domain' => strtolower($request->input('domain', $customDomain->domain)),
            'cloudflare_zone_id' => $request->input('cloudflare_zone_id', $customDomain->cloudflare_zone_id),
            'api_key_id' => $request->has('api_key_id') ? ($request->integer('api_key_id') ?: null) : $customDomain->api_key_id,
            'allowed_nest_ids' => $request->has('allowed_nest_ids')
                ? array_values(array_unique(array_map('intval', (array) $request->input('allowed_nest_ids', []))))
                : ($customDomain->allowed_nest_ids ?? []),
            'allowed_egg_ids' => $request->has('allowed_egg_ids')
                ? array_values(array_unique(array_map('intval', (array) $request->input('allowed_egg_ids', []))))
                : ($customDomain->allowed_egg_ids ?? []),
            'service_tag' => $request->has('service_tag')
                ? ($request->filled('service_tag') ? strtolower((string) $request->input('service_tag')) : null)
                : $customDomain->service_tag,
            'egg_service_tags' => $request->has('egg_service_tags')
                ? $this->sanitizeEggServiceTags((array) $request->input('egg_service_tags', []))
                : ($customDomain->egg_service_tags ?? (object) []),
            'wildcard_enabled' => $request->boolean('wildcard_enabled', $customDomain->wildcard_enabled),
            'enabled' => $request->boolean('enabled', $customDomain->enabled),
        ]);

        return response()->json(['data' => $customDomain->fresh()]);
    }

    public function destroy(DeleteCustomDomainRequest $request, CustomDomain $customDomain): Response
    {
        $customDomain->delete();

        return $this->returnNoContent();
    }

    public function apiKeys(GetCustomDomainApiKeysRequest $request): JsonResponse
    {
        $keys = CustomDomainApiKey::query()->orderBy('name')->get()->map(function (CustomDomainApiKey $key) {
            return [
                'id' => $key->id,
                'name' => $key->name,
                'enabled' => $key->enabled,
                'created_at' => $key->created_at,
                'updated_at' => $key->updated_at,
            ];
        })->values();

        return response()->json(['data' => $keys]);
    }

    public function storeApiKey(StoreCustomDomainApiKeyRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $key = CustomDomainApiKey::query()->create([
            'name' => trim((string) $validated['name']),
            'token' => trim((string) $validated['token']),
            'enabled' => (bool) ($validated['enabled'] ?? true),
        ]);

        return response()->json([
            'data' => [
                'id' => $key->id,
                'name' => $key->name,
                'enabled' => $key->enabled,
                'created_at' => $key->created_at,
                'updated_at' => $key->updated_at,
            ],
        ], Response::HTTP_CREATED);
    }

    public function updateApiKey(UpdateCustomDomainApiKeyRequest $request, CustomDomainApiKey $apiKey): JsonResponse
    {
        $validated = $request->validated();

        $payload = [];
        if (array_key_exists('name', $validated)) {
            $payload['name'] = trim((string) $validated['name']);
        }
        if (!empty($validated['token'])) {
            $payload['token'] = trim((string) $validated['token']);
        }
        if (array_key_exists('enabled', $validated)) {
            $payload['enabled'] = (bool) $validated['enabled'];
        }

        if (!empty($payload)) {
            $apiKey->update($payload);
        }

        return response()->json([
            'data' => [
                'id' => $apiKey->id,
                'name' => $apiKey->name,
                'enabled' => $apiKey->enabled,
                'created_at' => $apiKey->created_at,
                'updated_at' => $apiKey->updated_at,
            ],
        ]);
    }

    public function deleteApiKey(DeleteCustomDomainApiKeyRequest $request, CustomDomainApiKey $apiKey): Response
    {
        if (CustomDomain::query()->where('api_key_id', $apiKey->id)->exists()) {
            abort(422, 'This API key is assigned to one or more custom domains.');
        }

        $apiKey->delete();

        return $this->returnNoContent();
    }

    public function options(GetCustomDomainsRequest $request, CustomDomainProvisioningService $service): JsonResponse
    {
        $nests = Nest::query()->orderBy('name')->get(['id', 'uuid', 'name', 'description']);
        $eggs = Egg::query()->with('nest:id,name')->orderBy('name')->get(['id', 'uuid', 'nest_id', 'name', 'description']);

        return response()->json([
            'data' => [
                'nests' => $nests,
                'eggs' => $eggs->map(function (Egg $egg) use ($service) {
                    return [
                        'id' => $egg->id,
                        'uuid' => $egg->uuid,
                        'nest_id' => $egg->nest_id,
                        'nest_name' => $egg->nest?->name,
                        'name' => $egg->name,
                        'description' => $egg->description,
                        'default_service_tag' => $service->getDefaultServiceTagForEgg($egg->name, $egg->nest?->name),
                    ];
                })->values(),
            ],
        ]);
    }

    private function sanitizeEggServiceTags(array $eggServiceTags): array
    {
        $result = [];
        foreach ($eggServiceTags as $eggId => $tag) {
            $id = (int) $eggId;
            if ($id < 1 || !is_string($tag)) {
                continue;
            }

            $normalized = strtolower(trim($tag));
            if ($normalized === '') {
                continue;
            }

            $result[(string) $id] = $normalized;
        }

        return $result;
    }
}
