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
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Attributes\MaxExceptions;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

/**
 * Provisions a single mapping. No overlap guard: the provisioning service
 * upserts, so two concurrent runs for one mapping converge on the same record.
 *
 * See ProvisionServerCustomDomainsJob for why tries is unbounded here.
 */
#[Timeout(180)]
#[Tries(0)]
#[MaxExceptions(3)]
#[Backoff([30, 120, 600])]
class ProvisionCustomDomainRecordJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public function __construct(private int $mappingId)
    {
    }

    public function middleware(): array
    {
        return [new RateLimited('cloudflare')];
    }

    public function retryUntil(): \DateTimeInterface
    {
        return now()->addMinutes(30);
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
