<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Illuminate\Http\JsonResponse;
use Everest\Models\ServerCustomDomain;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Jobs\CustomDomains\ProvisionCustomDomainRecordJob;
use Everest\Jobs\CustomDomains\ProvisionServerCustomDomainsJob;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;
use Everest\Http\Requests\Api\Client\Servers\CustomDomains\GetCustomDomainsRequest;
use Everest\Http\Requests\Api\Client\Servers\CustomDomains\StoreCustomDomainRequest;
use Everest\Http\Requests\Api\Client\Servers\CustomDomains\SyncCustomDomainsRequest;
use Everest\Http\Requests\Api\Client\Servers\CustomDomains\DeleteCustomDomainRequest;

class CustomDomainController extends ClientApiController
{
    public function __construct(private CustomDomainProvisioningService $service)
    {
        parent::__construct();
    }

    public function index(GetCustomDomainsRequest $request, Server $server): JsonResponse
    {
        $records = $server->customDomains()->with('customDomain')->orderByDesc('id')->get()->map(function ($row) {
            $dnsRecords = (array) ($row->dns_records ?? []);
            $hasSrv = collect($dnsRecords)->contains(fn ($record) => ($record['kind'] ?? null) === 'srv');
            $hostType = collect($dnsRecords)->firstWhere('kind', 'host')['type'] ?? null;

            return [
                'id' => $row->id,
                'domain_id' => $row->custom_domain_id,
                'domain' => $row->customDomain?->domain,
                'subdomain' => $row->subdomain,
                'full_domain' => $row->full_domain,
                'port' => $row->port,
                'protocol' => $row->protocol,
                'service_tag' => $row->service_tag,
                'record_type' => $hasSrv ? 'srv' : 'cname',
                'host_record_type' => $hostType,
                'status' => $row->status,
                'last_error' => $row->last_error,
                'last_synced_at' => $row->last_synced_at,
            ];
        })->values();

        return response()->json(['data' => $records]);
    }

    public function store(StoreCustomDomainRequest $request, Server $server): JsonResponse
    {
        $domainId = (int) $request->input('domain_id');
        $subdomain = strtolower((string) $request->input('subdomain'));
        $port = (int) $request->input('port');
        $protocol = (string) $request->input('protocol', 'both');
        $recordType = $request->filled('record_type') ? strtolower((string) $request->input('record_type')) : null;
        $serviceTag = $request->filled('service_tag') ? strtolower((string) $request->input('service_tag')) : null;

        $this->service->createFromPayload($server, [[
            'domain_id' => $domainId,
            'subdomain' => $subdomain,
            'port' => $port,
            'protocol' => $protocol,
            'record_type' => $recordType,
            'service_tag' => $serviceTag,
        ]]);

        $mapping = $server->customDomains()
            ->where('custom_domain_id', $domainId)
            ->where('subdomain', $subdomain)
            ->where('port', $port)
            ->where('protocol', $protocol)
            ->latest()
            ->first();

        if ($mapping) {
            ProvisionCustomDomainRecordJob::dispatch($mapping->id);
        } else {
            ProvisionServerCustomDomainsJob::dispatch($server->id);
        }

        return response()->json([], JsonResponse::HTTP_CREATED);
    }

    public function options(GetCustomDomainsRequest $request, Server $server): JsonResponse
    {
        $recommendation = $this->service->getDnsRecommendationForServer($server);

        $domains = collect($this->service->getAvailableDomains($server))->map(function ($domain) use ($server) {
            return [
                'id' => $domain->id,
                'domain' => $domain->domain,
                'wildcard_enabled' => $domain->wildcard_enabled,
                'default_service_tag' => $this->service->resolveSuggestedServiceTag($server, $domain),
            ];
        })->map(function (array $domain) use ($recommendation) {
            return array_merge($domain, [
                'recommended_record_type' => $recommendation['recommended_record_type'],
                'srv_supported' => $recommendation['srv_supported'],
                'allow_record_type_selection' => $recommendation['allow_record_type_selection'],
                'forced_record_type' => $recommendation['forced_record_type'],
                'dns_mode' => $recommendation['mode'],
                'recommendation_notice' => $recommendation['notice'],
                'connection_hint' => $recommendation['connection_hint'],
            ]);
        })->values();

        return response()->json(['data' => $domains]);
    }

    public function destroy(DeleteCustomDomainRequest $request, Server $server, ServerCustomDomain $customDomain): JsonResponse
    {
        if ($customDomain->server_id !== $server->id) {
            abort(404);
        }

        $this->service->cleanup($customDomain);
        $customDomain->delete();

        return response()->json([], JsonResponse::HTTP_NO_CONTENT);
    }

    public function sync(SyncCustomDomainsRequest $request, Server $server): JsonResponse
    {
        ProvisionServerCustomDomainsJob::dispatch($server->id);

        return response()->json(['message' => 'Custom domain provisioning has been queued.']);
    }
}
