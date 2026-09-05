<?php

namespace Everest\Http\Requests\Api\Application\Queues;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Discarding a failure destroys the only copy of the job's payload -- there is
 * no undo and nothing to restore from, since the row *is* the record. That is a
 * different kind of authority from re-running work, so it is a capability of
 * its own rather than something bundled with retry.
 */
class DeleteFailedJobRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::QUEUES_DELETE;
    }

    public function rules(): array
    {
        return [
            // Present when discarding a selection. Bounded so one request
            // cannot walk the whole table, and mutually exclusive with the
            // sweep scope: a request carrying both shapes is ambiguous, and the
            // ambiguity resolves towards deleting far more than was asked for.
            'uuids' => 'sometimes|array|min:1|max:200|prohibits:queue,olderThanDays',
            // A format, not just a length. `queue:retry` reads a lone id of
            // `all` as "every failure in the table"; nothing shaped like a uuid
            // can ever reach a sentinel like that.
            'uuids.*' => 'required|uuid',

            // Present when sweeping. Both are scoped on purpose: there is no
            // shape of this request that means "delete everything".
            'queue' => 'sometimes|nullable|string|max:191',
            'olderThanDays' => 'sometimes|nullable|integer|min:1|max:365',
        ];
    }
}
