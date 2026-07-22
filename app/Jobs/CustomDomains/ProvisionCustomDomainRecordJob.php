<?php

namespace Everest\Jobs\CustomDomains;

use Illuminate\Bus\Queueable;
use Everest\Models\ServerCustomDomain;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

class ProvisionCustomDomainRecordJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public function __construct(private int $mappingId)
    {
    }

    public function handle(CustomDomainProvisioningService $service): void
    {
        $mapping = ServerCustomDomain::query()->with(['customDomain', 'server.node', 'allocation'])->find($this->mappingId);
        if (!$mapping) {
            return;
        }

        $service->provision($mapping);
    }
}
