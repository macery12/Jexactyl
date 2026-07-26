<?php

namespace Everest\Http\Requests\Api\Application\Theme;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class GetThemeRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        return AdminRole::THEME_READ;
    }
}
