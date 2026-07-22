<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Illuminate\Queue\SerializesModels;
use Illuminate\Foundation\Events\Dispatchable;

class PaymentReceived
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(
        public User $user,
        public float $amount,
        public string $currency,
        public string $paymentMethod,
        public ?string $invoiceId = null,
        public string $correlationId = '',
        public bool $isRenewal = false,
        public ?float $originalAmount = null,
        public ?float $discountAmount = null,
        public ?string $couponCode = null,
        public ?int $billingDays = null,
        // Invoice attachment support
        public ?string $invoiceDownloadUrl = null,
        public ?string $invoiceFilePath = null,
        public ?string $invoiceFileDisk = null,
        public ?string $invoiceFileName = null,
    ) {
    }
}
