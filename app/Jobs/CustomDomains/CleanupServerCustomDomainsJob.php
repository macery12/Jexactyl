<?php

namespace Everest\Jobs\CustomDomains;

use Illuminate\Bus\Queueable;
use Everest\Models\ServerCustomDomain;
use Illuminate\Queue\Attributes\Tries;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\Attributes\Backoff;
use Illuminate\Queue\Attributes\Timeout;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

/**
 * Today this is only ever dispatched synchronously, from ServerDeletionService,
 * because an async cleanup lost the rows to the FK cascade. The attributes are
 * here so it stays bounded if it is ever queued — deletion is not rate limited,
 * since a server is already gone by the time this runs.
 */
#[Timeout(180)]
#[Tries(3)]
#[Backoff([30, 120, 600])]
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
