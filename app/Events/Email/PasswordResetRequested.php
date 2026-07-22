<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Everest\Events\Event;
use Illuminate\Queue\SerializesModels;

class PasswordResetRequested extends Event
{
    use SerializesModels;

    /**
     * Create a new event instance.
     */
    public function __construct(
        public User $user,
        public string $resetUrl,
        public string $correlationId,
    ) {
    }
}
