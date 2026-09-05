<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * A live inference can load a local model and is more than a read-only status
 * check, so only administrators allowed to change the AI connection may run it.
 */
class ProbeToolCallingRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::AI_UPDATE;
    }
}
