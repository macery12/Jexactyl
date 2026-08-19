<?php

namespace Everest\Http\Requests\Api\Application\Queues;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Re-dispatching a failed job runs it again for real -- it can send mail, charge
 * a card, or talk to a node -- so it is a capability of its own rather than a
 * side effect of being able to look at the queue page.
 */
class RetryFailedJobRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::QUEUES_RETRY;
    }
}
