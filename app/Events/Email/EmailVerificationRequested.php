<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Everest\Events\Event;
use Illuminate\Queue\SerializesModels;

class EmailVerificationRequested extends Event
{
    use SerializesModels;

    public function __construct(
        public User $user,
        public string $verificationUrl,
        public string $correlationId,
    ) {
    }
}
