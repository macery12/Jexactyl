<?php

namespace Everest\Http\Requests\Api\Application\Settings;

use Everest\Models\AdminRole;
use Everest\Http\Controllers\Api\Application\Settings\FeaturesController;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateFeatureTogglesRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        $rules = [];
        foreach (array_keys(FeaturesController::FEATURES) as $key) {
            $rules[$key] = 'sometimes|boolean';
        }

        return $rules;
    }

    public function permission(): string
    {
        return AdminRole::SETTINGS_UPDATE;
    }
}
