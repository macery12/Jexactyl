<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Everest\Models\Server;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;

class ServerRenewalNotice
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(
        public User $user,
        public Server $server,
        public string $renewalUrl,
        public string $renewalDate,
        public string $suspensionTime,
        public float $renewalAmount,
        public string $currency,
        public int $billingDays = 30,
        public string $correlationId = '',
    ) {
    }
}
