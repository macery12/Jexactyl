<?php

namespace Everest\Http\Requests\Api\Application\Intelligence;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetIntelligenceRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::AI_READ;
    }
}
