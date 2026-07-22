<?php

namespace Everest\Http\Controllers\Api\Client\Billing;

use Everest\Models\Egg;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

class CustomDomainOptionsController extends ClientApiController
{
    public function __construct(private CustomDomainProvisioningService $service)
    {
        parent::__construct();
    }

    public function index(Request $request): JsonResponse
    {
        $eggId = (int) $request->query('egg_id', 0);
        $egg = $eggId > 0 ? Egg::query()->with('nest:id,name')->find($eggId) : null;
        $recommendation = $this->service->getDnsRecommendationForEgg($egg?->name, $egg?->nest?->name);

        $domains = collect($this->service->getAvailableDomains())->map(function ($domain) use ($egg, $recommendation) {
            $eggTag = null;
            if ($egg) {
                $eggServiceTags = (array) ($domain->egg_service_tags ?? []);
                $eggTag = $eggServiceTags[(string) $egg->id] ?? null;
            }

            return [
                'id' => $domain->id,
                'domain' => $domain->domain,
                'wildcard_enabled' => $domain->wildcard_enabled,
                'default_service_tag' => $eggTag
                    ? strtolower((string) $eggTag)
                    : ($domain->service_tag
                        ? strtolower((string) $domain->service_tag)
                        : $this->service->getDefaultServiceTagForEgg($egg?->name, $egg?->nest?->name)),
                'recommended_record_type' => $recommendation['recommended_record_type'],
                'srv_supported' => $recommendation['srv_supported'],
                'allow_record_type_selection' => $recommendation['allow_record_type_selection'],
                'forced_record_type' => $recommendation['forced_record_type'],
                'dns_mode' => $recommendation['mode'],
                'recommendation_notice' => $recommendation['notice'],
                'connection_hint' => $recommendation['connection_hint'],
            ];
        })->values();

        return response()->json(['data' => $domains]);
    }
}
