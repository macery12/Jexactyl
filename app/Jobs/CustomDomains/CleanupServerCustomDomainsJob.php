<?php

namespace Everest\Jobs\CustomDomains;

use Illuminate\Bus\Queueable;
use Everest\Models\ServerCustomDomain;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

class CleanupServerCustomDomainsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public function __construct(private int $serverId)
    {
    }

    public function handle(CustomDomainProvisioningService $service): void
    {
        $mappings = ServerCustomDomain::query()
            ->with('customDomain')
            ->where('server_id', $this->serverId)
            ->get();

        foreach ($mappings as $mapping) {
            $service->cleanup($mapping);
            $mapping->delete();
        }
    }
}
