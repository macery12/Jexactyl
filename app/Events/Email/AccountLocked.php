<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Everest\Events\Event;
use Illuminate\Queue\SerializesModels;

class AccountLocked extends Event
{
    use SerializesModels;

    /**
     * Create a new event instance.
     */
    public function __construct(
        public User $user,
        public string $reason,
        public string $correlationId,
    ) {
    }
}
