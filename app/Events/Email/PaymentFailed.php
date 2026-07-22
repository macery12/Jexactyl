<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;

class PaymentFailed
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(
        public User $user,
        public float $amount,
        public string $currency,
        public string $reason,
        public ?string $invoiceId = null,
        public string $correlationId = '',
        public string $paymentMethod = 'Unknown',
        public bool $isRenewal = false,
    ) {
    }
}
