<?php

namespace Everest\Jobs\CustomDomains;

use Everest\Models\Server;
use Illuminate\Bus\Queueable;
use Illuminate\Queue\Attributes\Tries;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\Attributes\Backoff;
use Illuminate\Queue\Attributes\Timeout;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Queue\Attributes\MaxExceptions;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Everest\Services\CustomDomains\CustomDomainProvisioningService;

/**
 * Re-provisions every custom-domain mapping on a server, which is N Cloudflare
 * round trips in a loop.
 *
 * `Tries(0)` with `MaxExceptions(3)` is the combination the queue docs call for
 * when middleware can release a job: a `RateLimited` release consumes an
 * attempt, so a fixed try count would let a busy Cloudflare budget exhaust the
 * job before it ever ran. Real errors are still bounded at three, and
 * retryUntil() stops it looping forever if the limiter never clears.
 *
 * Retrying is safe — CustomDomainProvisioningService creates-or-updates each
 * record rather than blindly creating.
 */
#[Timeout(180)]
#[Tries(0)]
#[MaxExceptions(3)]
#[Backoff([30, 120, 600])]
class ProvisionServerCustomDomainsJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public function __construct(private int $serverId)
    {
    }

    public function middleware(): array
    {
        return [
            // A bulk re-provision stacking on itself would double the API spend
            // for no benefit; the later run would only redo the same upserts.
            (new WithoutOverlapping('domains:server:' . $this->serverId))
                ->dontRelease()
                ->expireAfter(600),
            new RateLimited('cloudflare'),
        ];
    }

    public function retryUntil(): \DateTimeInterface
    {
        return now()->addMinutes(30);
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
