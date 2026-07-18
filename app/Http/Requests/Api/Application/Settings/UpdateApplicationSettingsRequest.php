<?php

namespace Everest\Http\Requests\Api\Application\Settings;

use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateApplicationSettingsRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        return [
            'app:name' => 'nullable|string|min:3|max:40',
            'app:logo' => 'nullable|url|max:255',
            'app:locale' => 'nullable|string|max:10',
            'app:user_locale' => 'nullable|bool',
            'app:indicators' => 'nullable|bool',
            'app:speed_dial' => 'nullable|bool',
        ];
    }

    public function permission(): string
    {
        return AdminRole::SETTINGS_UPDATE;
    }
}
