<?php

namespace Everest\Http\Requests\Api\Application\Queues;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class QueueHealthRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::QUEUES_READ;
    }
}
