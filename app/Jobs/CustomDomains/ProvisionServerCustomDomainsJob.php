<?php

namespace Everest\Jobs\CustomDomains;

use Everest\Models\Server;
use Illuminate\Bus\Queueable;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

class ProvisionServerCustomDomainsJob implements ShouldQueue
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
        $server = Server::query()->with('customDomains.customDomain')->find($this->serverId);
        if (!$server) {
            return;
        }

        foreach ($server->customDomains as $mapping) {
            $service->provision($mapping);
        }
    }
}
