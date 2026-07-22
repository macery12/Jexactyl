<?php

namespace Everest\Events\Email;

use Everest\Models\User;
use Everest\Events\Event;
use Illuminate\Queue\SerializesModels;

class TwoFactorDisabled extends Event
{
    use SerializesModels;

    /**
     * Create a new event instance.
     */
    public function __construct(
        public User $user,
        public string $correlationId,
    ) {
    }
}
