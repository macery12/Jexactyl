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

    public function rules(): array
    {
        return [
            // Present only on the bulk endpoint. Bounded so one request cannot
            // re-run the entire failed table -- every one of these does real
            // work: sends mail, calls a node, charges a card.
            'uuids' => 'sometimes|array|min:1|max:100',
            // A format, not just a length: `queue:retry` treats a lone id of
            // `all` as "retry every failure in the table", and an id that must
            // look like a uuid can never be that.
            'uuids.*' => 'required|uuid',
        ];
    }
}
